import { createHash } from "crypto";
import { CACHE_SCHEMA_VERSION, CacheEntry, CacheFile, TextFileIO } from "../types";

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
  /** 最后一次成功落盘时间戳（ms）；未落盘过为 null（v1.1.0 缓存页展示） */
  lastFlushAt: number | null;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
/** v1.1.5 单条目字符上限（src+tgt）：UI 文本远低于 2KB，失控嵌套产物单条可达数 MB（540MB 缓存事故防线） */
const MAX_ENTRY_CHARS = 4000;
/** v1.1.5 磁盘文件总字节预算（近似）：条数上限之外的硬顶，超出按 updatedAt 从旧到新淘汰 */
const DISK_MAX_BYTES = 8 * 1024 * 1024;

/**
 * 缓存管理（设计文档 4.2.3）
 * - 键：sha256(原文 + providerId + targetLang + model) 取前 16 位十六进制，
 *   多引擎 / 多语言 / 多模型互不污染；Node crypto 同步计算，不走异步 crypto.subtle
 * - 内存 Map + LRU（默认上限 5000）；磁盘 JSON（默认上限 20000 条 + 8MB 字节硬顶，超限按 updatedAt 最旧淘汰）
 * - v1.1.5 体积防护：单条目 src+tgt 超 4000 字符拒绝写入 / load 时剔除（嵌套失控产物曾达 540MB）
 * - 版本维度：get 传入 currentFrom（pluginId@version / core@appVersion），不符即惰性失效
 * - 90 天未命中的条目在 load 时清理
 * - 落盘策略（每 30s 或累计 100 条、onunload 强制 flush）由装配层驱动，
 *   本类只暴露 pendingWrites 与 flush()
 */
export class CacheManager {
  static makeKey(src: string, providerId: string, targetLang: string, model: string): string {
    return createHash("sha256")
      .update(src + providerId + targetLang + model)
      .digest("hex")
      .slice(0, 16);
  }

  private mem = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private loaded = false;
  private dirtyCount = 0;
  private lastFlushAt: number | null = null;

  constructor(
    private io: TextFileIO,
    private filePath: string,
    private maxEntries = 5000,
    private diskMaxEntries = 20000,
    private now: () => number = () => Date.now(),
    /** 版本迁移表：键为目标版本号（migrations[1] 把 v0 迁到 v1）；当前为空（v1 起步，框架预留） */
    private migrations: Record<number, (file: CacheFile) => CacheFile> = {}
  ) {}

  /** 待落盘新条目数（配合「累计 100 条批量写入」策略） */
  get pendingWrites(): number {
    return this.dirtyCount;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!(await this.io.exists(this.filePath))) return;
    let file: CacheFile;
    try {
      file = JSON.parse(await this.io.read(this.filePath)) as CacheFile;
    } catch {
      return; // 损坏文件视为空缓存
    }
    if (
      typeof file.schemaVersion !== "number" ||
      file.schemaVersion > CACHE_SCHEMA_VERSION
    ) {
      return; // 更高版本文件不读取（前向兼容保护）
    }
    // schemaVersion 迁移（4.2.3 / Phase 4）：旧版本文件按迁移表逐段升级
    if (file.schemaVersion < CACHE_SCHEMA_VERSION) {
      const migrated = this.migrate(file);
      if (!migrated) return; // 缺迁移路径：放弃该文件，视为空缓存（不抛异常）
      file = migrated;
    }
    const cutoff = this.now() - NINETY_DAYS_MS;
    const entries = Object.entries(file.entries ?? {})
      // v1.1.5：超大条目在 load 时剔除——旧版本嵌套失控产物的垃圾条目由此自动自愈（flush 后文件即瘦身）
      .filter(([, e]) => e.updatedAt >= cutoff && e.src.length + e.tgt.length <= MAX_ENTRY_CHARS)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, this.diskMaxEntries);
    for (const [key, e] of entries) {
      this.mem.set(key, e);
    }
    this.evictIfNeeded();
  }

  /** 逐段迁移至当前版本；缺迁移路径返回 null */
  private migrate(file: CacheFile): CacheFile | null {
    let cur = file;
    while (cur.schemaVersion < CACHE_SCHEMA_VERSION) {
      const next = this.migrations[cur.schemaVersion + 1];
      if (!next) return null;
      cur = next(cur);
    }
    return cur;
  }

  /**
   * 查询缓存。传入 currentFrom 时启用版本维度惰性失效（设计文档 D5）：
   * 条目来源版本与当前版本不符则视为未命中并移除。
   */
  get(key: string, currentFrom?: string): CacheEntry | null {
    const entry = this.mem.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (currentFrom !== undefined && entry.from !== currentFrom) {
      this.mem.delete(key);
      this.misses++;
      return null;
    }
    entry.hits++;
    this.hits++;
    // LRU：命中重插到末尾
    this.mem.delete(key);
    this.mem.set(key, entry);
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    // v1.1.5：超大条目拒绝入缓存（超长文本由 FilterEngine 规则 2b 前置拒译，此处为最后兜底）
    if (entry.src.length + entry.tgt.length > MAX_ENTRY_CHARS) return;
    this.mem.delete(key);
    this.mem.set(key, entry);
    this.dirtyCount++;
    this.evictIfNeeded();
  }

  /** 批量落盘：内存视图（含 load 读入的磁盘条目）按条数与字节双上限截断后写 JSON */
  async flush(): Promise<void> {
    await this.load();
    const sorted = [...this.mem.entries()]
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, this.diskMaxEntries);
    // v1.1.5 字节硬顶：条数之外再按体积截断（key+src+tgt+from+JSON 结构开销近似 128B/条）
    let bytes = 0;
    const kept: Record<string, CacheEntry> = {};
    for (const [key, e] of sorted) {
      bytes += key.length + e.src.length + e.tgt.length + e.from.length + 128;
      if (bytes > DISK_MAX_BYTES) break;
      kept[key] = e;
    }
    const file: CacheFile = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      entries: kept,
    };
    await this.io.write(this.filePath, JSON.stringify(file, null, 2));
    this.dirtyCount = 0;
    this.lastFlushAt = this.now();
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.mem.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      lastFlushAt: this.lastFlushAt,
    };
  }

  clear(): void {
    this.mem.clear();
    this.hits = 0;
    this.misses = 0;
    this.dirtyCount = 0;
  }

  /**
   * 导入缓存条目（4.5 缓存 Tab 导入；FR-12 用户间共享词表）
   * 逐条校验结构（src/tgt 为非空字符串），非法条目跳过；返回实际导入条数
   */
  importEntries(entries: Record<string, unknown>): number {
    let count = 0;
    for (const [key, raw] of Object.entries(entries)) {
      const e = raw as Partial<CacheEntry>;
      if (
        typeof e?.src === "string" && e.src.length > 0 &&
        typeof e?.tgt === "string" && e.tgt.length > 0
      ) {
        this.set(key, {
          src: e.src,
          tgt: e.tgt,
          provider: typeof e.provider === "string" ? e.provider : "imported",
          lang: typeof e.lang === "string" ? e.lang : "",
          from: typeof e.from === "string" ? e.from : "",
          hits: typeof e.hits === "number" ? e.hits : 0,
          updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
        });
        count++;
      }
    }
    return count;
  }

  private evictIfNeeded(): void {
    while (this.mem.size > this.maxEntries) {
      const oldestKey = this.mem.keys().next().value;
      if (oldestKey === undefined) break;
      this.mem.delete(oldestKey);
    }
  }
}

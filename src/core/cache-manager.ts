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
/** 磁盘文件总字节预算（近似）：条数上限之外的硬顶，超出按 updatedAt 从旧到新淘汰
 *  （v1.1.5 设 8MB；v1.1.9 上调 64MB——540MB 事故根因是嵌套失控产物，已由单条 4000 字符防线根治；
 *  64MB 仍低于 GitHub 100MB 单文件限制） */
const DISK_MAX_BYTES = 64 * 1024 * 1024;
/** B4：.bak 兜底副本的节流刷新间隔（主文件仍按装配层节奏写；.bak 略旧无妨，仅在主文件损坏时兜底） */
const BAK_REFRESH_MS = 5 * 60 * 1000;

/**
 * 缓存管理（设计文档 4.2.3）
 * - 键：sha256(原文 + providerId + targetLang + model) 取前 16 位十六进制，
 *   多引擎 / 多语言 / 多模型互不污染；Node crypto 同步计算，不走异步 crypto.subtle
 * - v1.2（B1）来源版本维度退役：键已精确锚定原文，from 失效只误伤未变文本
 *   （Obsidian/插件每次升级即全量重译的根因）；from 转为遗留字段，新写入不再赋值
 * - v1.2（B2）命中刷新 lastAccessAt（不增脏计数，经 accessedSinceFlush 配合装配层
 *   保底落盘）；90 天淘汰与 flush 排序统一按 lastAccessAt ?? updatedAt 口径
 * - 内存 Map + LRU 与磁盘 JSON 同一容量上限（默认 50000 条，设置页可调 1000–200000）；磁盘另有
 *   64MB 字节硬顶，超限均按最近访问时间从旧到新淘汰（v1.1.9 单容量——原"内存 5000 / 磁盘 20000"
 *   双层因 flush 只写内存而不可达）
 * - v1.1.5 体积防护：单条目 src+tgt 超 4000 字符拒绝写入 / load 时剔除（嵌套失控产物曾达 540MB）
 * - v1.2（B4）：主文件损坏时 load 回落 translation-cache.json.bak（由 flush 节流刷新）
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
  private accessDirty = false;
  private lastBakAt = 0;

  constructor(
    private io: TextFileIO,
    private filePath: string,
    private maxEntries = 20000,
    /** 缺省与 maxEntries 同值（v1.1.9 单容量）；独立传值仅用于测试磁盘截断 */
    private diskMaxEntries = maxEntries,
    private now: () => number = () => Date.now(),
    /** 版本迁移表：键为目标版本号（migrations[1] 把 v0 迁到 v1）；当前为空（v1 起步，框架预留） */
    private migrations: Record<number, (file: CacheFile) => CacheFile> = {}
  ) {}

  /** 待落盘新条目数（配合「累计 100 条批量写入」策略） */
  get pendingWrites(): number {
    return this.dirtyCount;
  }

  /** B2：自上次 flush 后是否发生过命中（装配层据此触发保底落盘，把访问时间写回磁盘） */
  get accessedSinceFlush(): boolean {
    return this.accessDirty;
  }

  /** v1.1.9：运行时调整容量上限（内存=磁盘同值，设置页热生效）；调小立即淘汰最旧条目 */
  setMaxEntries(n: number): void {
    this.maxEntries = n;
    this.diskMaxEntries = n;
    this.evictIfNeeded();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let file = await this.readFile(this.filePath);
    if (file === null) {
      // B4：主文件损坏/不存在时回落备份（.bak 由 flush 节流刷新）
      file = await this.readFile(`${this.filePath}.bak`);
    }
    if (file === null) return;
    // schemaVersion 迁移（4.2.3 / Phase 4）：旧版本文件按迁移表逐段升级
    if (file.schemaVersion < CACHE_SCHEMA_VERSION) {
      const migrated = this.migrate(file);
      if (!migrated) return; // 缺迁移路径：放弃该文件，视为空缓存（不抛异常）
      file = migrated;
    }
    const cutoff = this.now() - NINETY_DAYS_MS;
    const entries = Object.entries(file.entries ?? {})
      // v1.1.5：超大条目在 load 时剔除——旧版本嵌套失控产物的垃圾条目由此自动自愈（flush 后文件即瘦身）
      // B2：90 天口径改为「最近访问」（lastAccessAt 缺省回落 updatedAt，旧文件行为不变）
      .filter(
        ([, e]) =>
          (e.lastAccessAt ?? e.updatedAt) >= cutoff && e.src.length + e.tgt.length <= MAX_ENTRY_CHARS
      )
      .sort(([, a], [, b]) => (b.lastAccessAt ?? b.updatedAt) - (a.lastAccessAt ?? a.updatedAt))
      .slice(0, this.diskMaxEntries)
      // v1.1.9：截断后反转为升序插入（最旧在 Map 头部）——此前降序插入使淘汰先删最新条目（LRU 倒置）
      .reverse();
    for (const [key, e] of entries) {
      this.mem.set(key, e);
    }
    this.evictIfNeeded();
  }

  /** 读取并校验缓存文件；不存在/损坏/更高版本返回 null（前向兼容保护） */
  private async readFile(path: string): Promise<CacheFile | null> {
    try {
      if (!(await this.io.exists(path))) return null;
      const parsed = JSON.parse(await this.io.read(path)) as CacheFile;
      if (
        typeof parsed.schemaVersion !== "number" ||
        parsed.schemaVersion > CACHE_SCHEMA_VERSION
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null; // 损坏文件视为空缓存
    }
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
   * 查询缓存。v1.2（B1）来源版本维度退役：缓存键已精确锚定原文文本，
   * 来源升级但文本未变的条目（占绝大多数）继续命中——不再整批删除重译
   */
  get(key: string): CacheEntry | null {
    const entry = this.mem.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    entry.hits++;
    this.hits++;
    // B2：命中刷新访问时间——不增 dirtyCount（否则每次命中都触发落盘写放大），
    // 由 accessedSinceFlush 配合装配层保底落盘周期性写回
    entry.lastAccessAt = this.now();
    this.accessDirty = true;
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
    // B4：.bak 节流刷新（≥5 分钟一次）——主文件损坏时的兜底副本；复制失败不阻塞主文件写入
    if (this.now() - this.lastBakAt >= BAK_REFRESH_MS) {
      const stamp = this.now();
      this.lastBakAt = stamp;
      try {
        if (await this.io.exists(this.filePath)) {
          await this.io.write(`${this.filePath}.bak`, await this.io.read(this.filePath));
        }
      } catch {
        // .bak 失败跳过：主文件写入照常
      }
    }
    const sorted = [...this.mem.entries()]
      // B2：磁盘保留优先级按最近访问时间（缺省回落 updatedAt）
      .sort(([, a], [, b]) => (b.lastAccessAt ?? b.updatedAt) - (a.lastAccessAt ?? a.updatedAt))
      .slice(0, this.diskMaxEntries);
    // v1.1.5 字节硬顶：条数之外再按体积截断（key+src+tgt+from+JSON 结构开销近似 128B/条）
    let bytes = 0;
    const kept: Record<string, CacheEntry> = {};
    for (const [key, e] of sorted) {
      bytes += key.length + e.src.length + e.tgt.length + (e.from?.length ?? 0) + 128;
      if (bytes > DISK_MAX_BYTES) break;
      kept[key] = e;
    }
    const file: CacheFile = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      entries: kept,
    };
    // B4：紧凑 JSON（原 2 空格缩进近乎翻倍文件体积；可读性要求只针对构建产物代码）
    await this.io.write(this.filePath, JSON.stringify(file));
    this.dirtyCount = 0;
    this.accessDirty = false;
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
    this.accessDirty = false;
  }

  /**
   * v1.1.9：清理与当前 引擎+语言+模型 不匹配的条目——缓存键含这三个维度，
   * 换过模型/引擎后旧条目永远不会再命中，纯占空间。无 model 字段的旧条目按引擎+语言判定。
   * 返回删除条数（计入待落盘，由调用方 flush）
   */
  purgeMismatched(provider: string, lang: string, model: string): number {
    let removed = 0;
    for (const [key, e] of [...this.mem.entries()]) {
      if (
        e.provider !== provider ||
        e.lang !== lang ||
        (e.model !== undefined && e.model !== model)
      ) {
        this.mem.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.dirtyCount += removed;
    return removed;
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
          // v1.1.9：透传模型标记（清理失效条目按模型判定）
          ...(typeof e.model === "string" ? { model: e.model } : {}),
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

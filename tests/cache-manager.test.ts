import { describe, expect, it } from "vitest";
import { CacheManager } from "../src/core/cache-manager";
import { CacheEntry, TextFileIO } from "../src/types";

class MemoryIO implements TextFileIO {
  files = new Map<string, string>();
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error("ENOENT");
    return v;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

function entry(src: string, from = "calendar@1.5.9", updatedAt = 1000): CacheEntry {
  return {
    src,
    tgt: "译：" + src,
    provider: "openai",
    lang: "zh-CN",
    from,
    hits: 0,
    updatedAt,
  };
}

const PATH = "translation-cache.json";

describe("CacheManager.makeKey", () => {
  it("同参数同键；provider / 语言 / 模型任一不同则键不同", () => {
    const k1 = CacheManager.makeKey("Open Settings", "openai", "zh-CN", "gpt-4o-mini");
    expect(k1).toBe(CacheManager.makeKey("Open Settings", "openai", "zh-CN", "gpt-4o-mini"));
    expect(k1).not.toBe(CacheManager.makeKey("Open Settings", "deepl", "zh-CN", "gpt-4o-mini"));
    expect(k1).not.toBe(CacheManager.makeKey("Open Settings", "openai", "ja", "gpt-4o-mini"));
    expect(k1).not.toBe(CacheManager.makeKey("Open Settings", "openai", "zh-CN", "gpt-4.1-nano"));
    expect(k1).toHaveLength(16);
  });
});

describe("CacheManager", () => {
  it("set/get 往返并统计命中率", () => {
    const cm = new CacheManager(new MemoryIO(), PATH);
    const key = CacheManager.makeKey("Open Settings", "openai", "zh-CN", "m");
    expect(cm.get(key)).toBeNull();
    cm.set(key, entry("Open Settings"));
    expect(cm.get(key)?.tgt).toBe("译：Open Settings");
    expect(cm.stats().hitRate).toBe(0.5);
  });

  it("内存 LRU 超限淘汰最早条目", () => {
    const cm = new CacheManager(new MemoryIO(), PATH, 3);
    ["a", "b", "c", "d"].forEach((s, i) => cm.set(`k${i}`, entry(s, "p@1", 1000 + i)));
    expect(cm.get("k0")).toBeNull(); // 最早插入的 a 已被淘汰
    expect(cm.get("k3")?.src).toBe("d");
    expect(cm.stats().size).toBe(3);
  });

  it("load 超限淘汰最旧条目（v1.1.9：磁盘上限缺省=内存上限；修复降序插入导致的 LRU 倒置）", async () => {
    const io = new MemoryIO();
    const t0 = Date.now();
    io.files.set(
      PATH,
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          k1: entry("a", "p@1", t0 - 3000),
          k2: entry("b", "p@1", t0 - 2000),
          k3: entry("c", "p@1", t0 - 1000),
        },
      })
    );
    const cm = new CacheManager(io, PATH, 2);
    await cm.load();
    expect(cm.get("k1")).toBeNull(); // 最旧的被淘汰
    expect(cm.get("k2")?.src).toBe("b");
    expect(cm.get("k3")?.src).toBe("c");
  });

  it("setMaxEntries 热生效：调小立即淘汰最旧，调大允许继续增长（v1.1.9）", () => {
    const cm = new CacheManager(new MemoryIO(), PATH, 3);
    ["a", "b", "c"].forEach((s, i) => cm.set(`k${i}`, entry(s, "p@1", 1000 + i)));
    cm.setMaxEntries(2);
    expect(cm.stats().size).toBe(2);
    expect(cm.get("k0")).toBeNull();
    cm.setMaxEntries(4);
    cm.set("k3", entry("d", "p@1", 1003));
    cm.set("k4", entry("e", "p@1", 1004));
    expect(cm.stats().size).toBe(4);
  });

  it("purgeMismatched：删除与当前 引擎/语言/模型 不匹配的条目并计数（v1.1.9 清理失效条目）", () => {
    const cm = new CacheManager(new MemoryIO(), PATH);
    cm.set("cur", { ...entry("Now"), model: "m1" });
    cm.set("oldModel", { ...entry("OldModel"), model: "m0" });
    cm.set("oldProvider", { ...entry("OldProvider"), provider: "deepl", model: "m1" });
    cm.set("oldLang", { ...entry("OldLang"), lang: "ja", model: "m1" });
    cm.set("legacy", entry("Legacy")); // 无 model 字段：按引擎+语言判定（与当前一致 → 保留）
    expect(cm.purgeMismatched("openai", "zh-CN", "m1")).toBe(3);
    expect(cm.get("cur")?.src).toBe("Now");
    expect(cm.get("legacy")?.src).toBe("Legacy");
    expect(cm.get("oldModel")).toBeNull();
    expect(cm.get("oldProvider")).toBeNull();
    expect(cm.get("oldLang")).toBeNull();
  });

  it("importEntries 透传 model 字段（v1.1.9 清理失效条目依赖模型标记）", () => {
    const cm = new CacheManager(new MemoryIO(), PATH);
    const n = cm.importEntries({
      withModel: { ...entry("Has"), model: "m1" },
      without: { src: "No", tgt: "译：No", provider: "openai", lang: "zh-CN" },
    } as never);
    expect(n).toBe(2);
    // 换模型后清理：withModel（m1≠m2）被删；without 无模型标记按引擎+语言判定保留
    expect(cm.purgeMismatched("openai", "zh-CN", "m2")).toBe(1);
    expect(cm.get("without")?.src).toBe("No");
  });

  it("stats.lastFlushAt：未落盘为 null，flush 后记录时间（v1.1.0 缓存页展示）", async () => {
    const cm = new CacheManager(new MemoryIO(), PATH, 5000, 20000, () => 1234567890);
    expect(cm.stats().lastFlushAt).toBeNull();
    cm.set(CacheManager.makeKey("Open Settings", "openai", "zh-CN", "m"), entry("Open Settings"));
    await cm.flush();
    expect(cm.stats().lastFlushAt).toBe(1234567890);
  });

  it("B1：来源版本维度退役——旧条目（含 from）在任何来源下均按文本键命中（D5 推翻）", () => {
    const cm = new CacheManager(new MemoryIO(), PATH);
    const key = CacheManager.makeKey("Open", "openai", "zh-CN", "m");
    cm.set(key, entry("Open", "calendar@1.5.9"));
    // 原 D5 行为：版本不符即删除重译——现文本未变即命中（升级零重译）
    expect(cm.get(key)?.tgt).toBe("译：Open");
    expect(cm.get(key)?.tgt).toBe("译：Open"); // 也不再被移除
  });

  it("B2：命中刷新 lastAccessAt 且不增待落盘计数；accessedSinceFlush 由 flush 复位", async () => {
    const io = new MemoryIO();
    let t = 1000;
    const cm = new CacheManager(io, PATH, 5000, 20000, () => t);
    cm.set("k", entry("A", "p@1", 1000));
    expect(cm.pendingWrites).toBe(1);
    expect(cm.accessedSinceFlush).toBe(false);
    t = 1000 + 60_000;
    expect(cm.get("k")?.lastAccessAt).toBe(61_000);
    expect(cm.pendingWrites).toBe(1); // 命中不增脏（无写放大）
    expect(cm.accessedSinceFlush).toBe(true);
    await cm.flush();
    expect(cm.accessedSinceFlush).toBe(false);
  });

  it("B2：90 天淘汰按最近访问——写于 91 天前但近期命中的条目存活", async () => {
    const io = new MemoryIO();
    const t0 = 1757000000000;
    const cm = new CacheManager(io, PATH, 5000, 20000, () => t0);
    const ancient = t0 - 91 * 24 * 60 * 60 * 1000;
    cm.set("survive", { ...entry("S", "p@1", ancient), lastAccessAt: t0 - 24 * 3600 * 1000 });
    cm.set("stale", entry("St", "p@1", ancient));
    await cm.flush();
    const cm2 = new CacheManager(io, PATH, 5000, 20000, () => t0);
    await cm2.load();
    expect(cm2.get("survive")?.src).toBe("S");
    expect(cm2.get("stale")).toBeNull();
  });

  it("flush/load 往返；90 天未命中条目在 load 时清理", async () => {
    const io = new MemoryIO();
    const t0 = 1757000000000;
    const cm = new CacheManager(io, PATH, 5000, 20000, () => t0);
    cm.set("fresh", entry("Fresh", "p@1", t0));
    cm.set("stale", entry("Stale", "p@1", t0 - 91 * 24 * 60 * 60 * 1000));
    await cm.flush();
    const cm2 = new CacheManager(io, PATH, 5000, 20000, () => t0);
    await cm2.load();
    expect(cm2.get("fresh")?.src).toBe("Fresh");
    expect(cm2.get("stale")).toBeNull();
  });

  it("磁盘上限按最近访问时间最旧淘汰（B2：lastAccessAt 缺省回落 updatedAt）", async () => {
    const io = new MemoryIO();
    const cm = new CacheManager(io, PATH, 5000, 2);
    cm.set("k1", entry("a", "p@1", 1000));
    cm.set("k2", entry("b", "p@1", 2000));
    cm.set("k3", entry("c", "p@1", 3000));
    await cm.flush();
    const file = JSON.parse(io.files.get(PATH)!) as { entries: Record<string, unknown> };
    expect(new Set(Object.keys(file.entries))).toEqual(new Set(["k2", "k3"]));
  });

  it("v1.1.5 体积防护：单条目 src+tgt 超 4000 字符拒绝写入（嵌套失控产物兜底）", () => {
    const cm = new CacheManager(new MemoryIO(), PATH);
    const huge = "译：( nested".repeat(300); // > 4000 字符，模拟嵌套乱码条目
    cm.set("huge", { ...entry("x".repeat(3000)), tgt: huge });
    expect(cm.get("huge")).toBeNull(); // 未入缓存
    expect(cm.pendingWrites).toBe(0);
    // 边界内正常写入
    cm.set("ok", entry("Normal Label"));
    expect(cm.get("ok")?.src).toBe("Normal Label");
  });

  it("v1.1.5 体积防护：load 时剔除超大条目（旧版垃圾缓存自动自愈）", async () => {
    const io = new MemoryIO();
    const t0 = Date.now();
    io.files.set(
      PATH,
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          good: entry("Good Label", "p@1", t0),
          garbage: { ...entry("x".repeat(3000), "p@1", t0), tgt: "译：( ".repeat(2000) },
        },
      })
    );
    const cm = new CacheManager(io, PATH);
    await cm.load();
    expect(cm.get("good")?.src).toBe("Good Label");
    expect(cm.get("garbage")).toBeNull();
  });

  it("v1.1.5 体积防护：flush 按字节硬顶截断（条数上限之外的第二道闸；v1.1.9 硬顶 8MB→64MB）", async () => {
    const io = new MemoryIO();
    const cm = new CacheManager(io, PATH, 200000, 200000); // 放开条数上限，专测字节闸
    // 每条约 3.9KB（src 1900 + tgt 1900 + 结构开销），64MB 约容 1.7 万条；写 17500 条必截断
    for (let i = 0; i < 17500; i++) {
      cm.set(`k${String(i).padStart(5, "0")}`, {
        ...entry("s".repeat(1900), "p@1", 1000 + i),
        tgt: "t".repeat(1900),
      });
    }
    await cm.flush();
    const file = JSON.parse(io.files.get(PATH)!) as { entries: Record<string, { updatedAt: number }> };
    const keys = Object.keys(file.entries);
    expect(keys.length).toBeLessThan(17500);
    expect(keys.length).toBeGreaterThan(15000); // 确实容下了上万条（非误杀）
    // 保留的是 updatedAt 最新的一批（最旧的 k00000 被淘汰）
    expect(file.entries["k17499"]).toBeTruthy();
    expect(file.entries["k00000"]).toBeUndefined();
  });

  it("损坏缓存文件视为空缓存，不抛异常", async () => {
    const io = new MemoryIO();
    io.files.set(PATH, "{not valid json");
    const cm = new CacheManager(io, PATH);
    await cm.load();
    expect(cm.get("anything")).toBeNull();
  });

  it("B4：主文件损坏时回落 .bak 兜底副本", async () => {
    const io = new MemoryIO();
    const t0 = Date.now();
    // 先落盘一份好数据，再手工制造主文件损坏（.bak 保留完好）
    const cm = new CacheManager(io, PATH, 5000, 20000, () => t0);
    cm.set("k", entry("Good", "p@1", t0));
    await cm.flush();
    await io.write(`${PATH}.bak`, io.files.get(PATH)!);
    io.files.set(PATH, "{corrupted");
    const cm2 = new CacheManager(io, PATH, 5000, 20000, () => t0);
    await cm2.load();
    expect(cm2.get("k")?.src).toBe("Good");
  });

  it("B4：.bak 节流刷新——5 分钟内第二次 flush 不重复复制", async () => {
    const io = new MemoryIO();
    let t = 1000;
    const cm = new CacheManager(io, PATH, 5000, 20000, () => t);
    cm.set("k", entry("A", "p@1", 1000));
    await cm.flush(); // 首 flush 写主文件（尚无旧主文件可复制，.bak 不产生）
    t += 60_000;
    cm.set("k2", entry("B", "p@1", t));
    await cm.flush(); // 距上次 .bak 标记 1 分钟 < 5 分钟：跳过复制
    expect(io.files.has(`${PATH}.bak`)).toBe(false);
    t += 5 * 60 * 1000;
    await cm.flush(); // 超过节流间隔：复制当前主文件为 .bak
    expect(io.files.has(`${PATH}.bak`)).toBe(true);
  });

  it("importEntries：合法条目导入、非法条目跳过并计数（4.5 导入校验）", () => {
    const cm = new CacheManager(new MemoryIO(), PATH);
    const n = cm.importEntries({
      good: entry("Hello"),
      bad1: { src: "x" },
      bad2: "not-an-object",
    } as never);
    expect(n).toBe(1);
    expect(cm.get("good")?.tgt).toBe("译：Hello");
  });

  it("schemaVersion 迁移：注册迁移路径后旧版本文件升级读取（4.2.3）", async () => {
    const io = new MemoryIO();
    io.files.set(
      PATH,
      JSON.stringify({ schemaVersion: 0, entries: { k: entry("Old", "p@1", Date.now()) } })
    );
    const cm = new CacheManager(io, PATH, 5000, 20000, undefined, {
      1: (f) => ({ ...f, schemaVersion: 1 }),
    });
    await cm.load();
    expect(cm.get("k")?.src).toBe("Old");
  });

  it("schemaVersion 迁移：缺迁移路径的旧版本视为空缓存（不抛异常）", async () => {
    const io = new MemoryIO();
    io.files.set(PATH, JSON.stringify({ schemaVersion: 0, entries: {} }));
    const cm = new CacheManager(io, PATH);
    await cm.load();
    expect(cm.get("k")).toBeNull();
  });

  it("更高 schemaVersion 文件不读取（前向兼容保护）", async () => {
    const io = new MemoryIO();
    io.files.set(PATH, JSON.stringify({ schemaVersion: 99, entries: { k: entry("New", "p@1", Date.now()) } }));
    const cm = new CacheManager(io, PATH);
    await cm.load();
    expect(cm.get("k")).toBeNull();
  });
});

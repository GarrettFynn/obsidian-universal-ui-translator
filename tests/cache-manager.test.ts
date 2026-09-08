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

  it("版本维度惰性失效：插件升级后旧条目不再命中（设计文档 D5 / 测试用例 7）", () => {
    const cm = new CacheManager(new MemoryIO(), PATH);
    const key = CacheManager.makeKey("Open", "openai", "zh-CN", "m");
    cm.set(key, entry("Open", "calendar@1.5.9"));
    expect(cm.get(key, "calendar@1.6.0")).toBeNull();
    expect(cm.get(key, "calendar@1.5.9")).toBeNull(); // 已移除，不再命中
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

  it("磁盘上限按 updatedAt 最旧淘汰", async () => {
    const io = new MemoryIO();
    const cm = new CacheManager(io, PATH, 5000, 2);
    cm.set("k1", entry("a", "p@1", 1000));
    cm.set("k2", entry("b", "p@1", 2000));
    cm.set("k3", entry("c", "p@1", 3000));
    await cm.flush();
    const file = JSON.parse(io.files.get(PATH)!) as { entries: Record<string, unknown> };
    expect(new Set(Object.keys(file.entries))).toEqual(new Set(["k2", "k3"]));
  });

  it("损坏缓存文件视为空缓存，不抛异常", async () => {
    const io = new MemoryIO();
    io.files.set(PATH, "{not valid json");
    const cm = new CacheManager(io, PATH);
    await cm.load();
    expect(cm.get("anything")).toBeNull();
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

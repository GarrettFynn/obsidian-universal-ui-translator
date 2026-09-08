import { describe, expect, it } from "vitest";
import { UsageTracker } from "../src/core/usage-tracker";
import { TextFileIO } from "../src/types";

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

const PATH = "usage.json";
const SEP = new Date(2026, 8, 6); // 2026-09-06

describe("UsageTracker（设计文档 4.5）", () => {
  it("记录本月用量并持久化，重载后可读", async () => {
    const io = new MemoryIO();
    const ut = new UsageTracker(io, PATH, () => SEP);
    await ut.record(100);
    await ut.record(50);
    const ut2 = new UsageTracker(io, PATH, () => SEP);
    expect(await ut2.monthChars()).toBe(150);
  });

  it("跨月自动清零", async () => {
    const io = new MemoryIO();
    const ut = new UsageTracker(io, PATH, () => SEP);
    await ut.record(500);
    const oct = new UsageTracker(io, PATH, () => new Date(2026, 9, 1));
    expect(await oct.monthChars()).toBe(0);
    await oct.record(10);
    expect(await oct.monthChars()).toBe(10);
  });

  it("预算超限判定：null 不限 / 达到即超限 / 未达到放行", async () => {
    const io = new MemoryIO();
    const ut = new UsageTracker(io, PATH, () => SEP);
    await ut.record(100);
    expect(await ut.isOverBudget(null)).toBe(false);
    expect(await ut.isOverBudget(100)).toBe(true);
    expect(await ut.isOverBudget(101)).toBe(false);
  });

  it("损坏文件视为零用量，不抛异常", async () => {
    const io = new MemoryIO();
    io.files.set(PATH, "{broken");
    const ut = new UsageTracker(io, PATH, () => SEP);
    expect(await ut.monthChars()).toBe(0);
  });
});

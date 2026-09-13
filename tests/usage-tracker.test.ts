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

  it("v1.1.9 逐日明细：record 双参记入日桶（条数+输入/输出字符），重载后保留", async () => {
    const io = new MemoryIO();
    const ut = new UsageTracker(io, PATH, () => SEP);
    await ut.record(100, 60);
    await ut.record(50, 30);
    const daily = await new UsageTracker(io, PATH, () => SEP).dailyStats(30);
    const today = daily[daily.length - 1];
    expect(today.date).toBe("2026-09-06");
    expect(today).toMatchObject({ calls: 2, inChars: 150, outChars: 90 });
  });

  it("v1.1.9 dailyStats 缺日补零且按日期升序（图表连续 X 轴）", async () => {
    const io = new MemoryIO();
    const ut = new UsageTracker(io, PATH, () => SEP);
    await ut.record(10, 5);
    const daily = await ut.dailyStats(30);
    expect(daily).toHaveLength(30);
    expect(daily[0].date).toBe("2026-08-08"); // 30 天窗口首日
    expect(daily[0]).toMatchObject({ calls: 0, inChars: 0, outChars: 0 });
    expect(daily[29].calls).toBe(1);
  });

  it("v1.1.9 monthStats 合计本月日桶", async () => {
    const io = new MemoryIO();
    const ut = new UsageTracker(io, PATH, () => SEP);
    await ut.record(100, 60);
    await ut.record(50, 30);
    expect(await ut.monthStats()).toEqual({ calls: 2, inChars: 150, outChars: 90 });
  });

  it("v1.1.9 逐日明细跨月保留（图表画近 30 天），月累计仍清零", async () => {
    const io = new MemoryIO();
    await new UsageTracker(io, PATH, () => SEP).record(200, 120);
    const oct = new UsageTracker(io, PATH, () => new Date(2026, 9, 1));
    expect(await oct.monthChars()).toBe(0); // 预算口径不变
    const daily = await oct.dailyStats(30);
    const sep6 = daily.find((d) => d.date === "2026-09-06");
    expect(sep6).toMatchObject({ calls: 1, inChars: 200, outChars: 120 });
  });

  it("v1.1.9 日桶剪枝：只保留近 62 天（文件体积控制）", async () => {
    const io = new MemoryIO();
    await new UsageTracker(io, PATH, () => SEP).record(100, 60);
    const later = new UsageTracker(io, PATH, () => new Date(2026, 10, 15)); // 70 天后
    const daily = await later.dailyStats(90);
    expect(daily.every((d) => d.calls === 0)).toBe(true);
  });

  it("v1.1.9 旧格式文件（无 days 字段）兼容：月累计可读，逐日明细为零", async () => {
    const io = new MemoryIO();
    io.files.set(PATH, JSON.stringify({ month: "2026-09", chars: 500 }));
    const ut = new UsageTracker(io, PATH, () => SEP);
    expect(await ut.monthChars()).toBe(500);
    expect(await ut.monthStats()).toEqual({ calls: 0, inChars: 0, outChars: 0 });
    expect((await ut.dailyStats(30)).every((d) => d.calls === 0)).toBe(true);
  });
});

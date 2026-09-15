import { describe, expect, it } from "vitest";
import { estimateTokenCost, fmtCompact, fmtCost } from "../src/core/format";

describe("fmtCompact（v1.3 状态栏紧凑数字）", () => {
  it("边界：999 原样 / 1000 → 1.0k / 999999 → 1000.0k / 1e6 → 1.0M", () => {
    expect(fmtCompact(0)).toBe("0");
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(1000)).toBe("1.0k");
    expect(fmtCompact(1234)).toBe("1.2k");
    expect(fmtCompact(999999)).toBe("1000.0k");
    expect(fmtCompact(1_000_000)).toBe("1.0M");
    expect(fmtCompact(2_340_000)).toBe("2.3M");
  });
});

describe("fmtCost（v1.3 费用估算展示）", () => {
  it("≥1 两位小数；<1 三位小数（低价模型日耗量级）；货币符号可自定义", () => {
    expect(fmtCost(12.345)).toBe("¥12.35");
    expect(fmtCost(1)).toBe("¥1.00");
    expect(fmtCost(0.999)).toBe("¥0.999");
    expect(fmtCost(0.004)).toBe("¥0.004");
    expect(fmtCost(0.03, "$")).toBe("$0.030");
  });
});

describe("estimateTokenCost（v1.3 按档单价估算）", () => {
  it("(in×输入价 + out×输出价) / 1e6；零消耗为零", () => {
    expect(estimateTokenCost(0, 0, { inputPerMillion: 2, outputPerMillion: 8 })).toBe(0);
    // 100 万输入 token × ¥2/M + 50 万输出 × ¥8/M = ¥2 + ¥4 = ¥6
    expect(
      estimateTokenCost(1_000_000, 500_000, { inputPerMillion: 2, outputPerMillion: 8 })
    ).toBeCloseTo(6, 10);
  });
});

import { describe, expect, it } from "vitest";
import { resolveObsidianVersion } from "../src/core/app-version";

describe("resolveObsidianVersion（R-05 / D5）", () => {
  it("appVersion 有效时直接使用", () => {
    expect(resolveObsidianVersion("1.13.7")).toBe("1.13.7");
  });

  it("appVersion 缺失/为空时返回 unknown（v1.1.11：UA 兜底因官方审查 navigator 禁令移除）", () => {
    expect(resolveObsidianVersion("")).toBe("unknown");
    expect(resolveObsidianVersion(undefined)).toBe("unknown");
    expect(resolveObsidianVersion(null)).toBe("unknown");
  });
});

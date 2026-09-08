import { describe, expect, it } from "vitest";
import { resolveObsidianVersion } from "../src/core/app-version";

describe("resolveObsidianVersion（R-05 / D5）", () => {
  it("appVersion 有效时直接使用", () => {
    expect(resolveObsidianVersion("1.13.7", "anything")).toBe("1.13.7");
  });

  it("appVersion 为空时解析 UA 中的 obsidian/x.y.z（手工验证实测场景）", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) obsidian/1.13.7 Chrome/132.0.0.0 Electron/34.0.0 Safari/537.36";
    expect(resolveObsidianVersion("", ua)).toBe("1.13.7");
  });

  it("两者皆无时返回 unknown（兜底，不抛异常）", () => {
    expect(resolveObsidianVersion(undefined, "Mozilla/5.0")).toBe("unknown");
    expect(resolveObsidianVersion(null, "")).toBe("unknown");
  });
});

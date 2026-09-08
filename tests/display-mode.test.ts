import { describe, expect, it } from "vitest";
import { formatWriteBack } from "../src/interceptors/display-mode";

describe("formatWriteBack（设计文档 5.1）", () => {
  it("replace：仅译文；译文与原文相同（已本地化/被过滤）返回 null 不回写", () => {
    expect(formatWriteBack("打开设置", "Open Settings", "replace", "{t} ({o})")).toBe("打开设置");
    expect(formatWriteBack("打开设置", "打开设置", "replace", "{t} ({o})")).toBeNull();
  });

  it("original：返回 null（暂停回写，流水线继续预热）", () => {
    expect(formatWriteBack("打开设置", "Open Settings", "original", "{t} ({o})")).toBeNull();
  });

  it("bilingual：按 bilingualFormat 组合两种格式", () => {
    expect(formatWriteBack("打开设置", "Open Settings", "bilingual", "{t} ({o})")).toBe(
      "打开设置 (Open Settings)"
    );
    expect(formatWriteBack("打开设置", "Open Settings", "bilingual", "{o} | {t}")).toBe(
      "Open Settings | 打开设置"
    );
  });
});

import { describe, expect, it } from "vitest";
import { FilterEngine } from "../src/filters/filter-engine";

describe("FilterEngine.shouldTranslate 规则链", () => {
  const fe = new FilterEngine();

  it("规则 1：用户自定义正则命中则拒绝", () => {
    const custom = new FilterEngine(["^Acme"]);
    expect(custom.shouldTranslate("Acme Corporation")).toBe(false);
    expect(custom.shouldTranslate("Open Settings")).toBe(true);
  });

  it("规则 2：纯数字 / 纯符号 / 长度 < 2 拒绝", () => {
    expect(fe.shouldTranslate("42")).toBe(false);
    expect(fe.shouldTranslate("100%")).toBe(false);
    expect(fe.shouldTranslate("A")).toBe(false);
  });

  it("规则 2b：长度 > 2000 拒绝（v1.1.5 成本与缓存体积硬上限）", () => {
    expect(fe.shouldTranslate("x".repeat(2000))).toBe(true); // 边界内放行
    expect(fe.shouldTranslate("x".repeat(2001))).toBe(false);
    // 失控嵌套文本形态（数 MB 级）必然命中此闸
    expect(fe.shouldTranslate("TaskNotes 有一个可选的 (".repeat(5000))).toBe(false);
  });

  it("规则 3：文件路径拒绝（设计文档测试用例 4）", () => {
    expect(fe.shouldTranslate("C:\\Users\\foo\\bar")).toBe(false);
    expect(fe.shouldTranslate("/usr/local/bin")).toBe(false);
    expect(fe.shouldTranslate("./config/app")).toBe(false);
    expect(fe.shouldTranslate("src/main.ts")).toBe(false);
    expect(fe.shouldTranslate("data.json")).toBe(false);
  });

  it("规则 4：URL / URI 拒绝", () => {
    expect(fe.shouldTranslate("https://example.com/page")).toBe(false);
    expect(fe.shouldTranslate("obsidian://open?vault=test")).toBe(false);
    expect(fe.shouldTranslate("mailto:a@b.com")).toBe(false);
  });

  it("规则 5：不含连续 2 个拉丁字母拒绝（已汉化文本不再送译）", () => {
    expect(fe.shouldTranslate("打开设置")).toBe(false);
    expect(fe.shouldTranslate("确定")).toBe(false);
  });

  it("规则 7：普通界面文本放行", () => {
    expect(fe.shouldTranslate("Open Settings")).toBe(true);
    expect(fe.shouldTranslate("OK")).toBe(true);
    expect(fe.shouldTranslate("Create new note")).toBe(true);
  });

  it("非法用户正则被忽略，不影响后续规则", () => {
    const broken = new FilterEngine(["("]);
    expect(broken.shouldTranslate("Open Settings")).toBe(true);
  });

  it("规则 5b：CJK 字符 ≥ 拉丁字母的已本地化混合文本拒绝（R-06）", () => {
    expect(fe.shouldTranslate("重新加载 Obsidian（不保存当前编辑内容）")).toBe(false);
    expect(fe.shouldTranslate("S1 自检")).toBe(false);
    // 英文主导的混合文本仍放行送译
    expect(fe.shouldTranslate("Auto-save 自动保存")).toBe(true);
    expect(fe.shouldTranslate("Open Settings")).toBe(true);
  });

  it("规则 5c：zh 目标语言下含 ≥2 个汉字即拒绝（v1.1.5 嵌套乱码防线）", () => {
    const zh = new FilterEngine([], "zh-CN");
    // 用户报告的乱码样本形态：双语回写产物拉丁字母多于汉字，可绕过 5b——5c 从结构上拦截
    expect(
      zh.shouldTranslate(
        "TaskNotes 有一个可选的 HTTP API。有一个 (TaskNotes has an optional HTTP API. There's a)"
      )
    ).toBe(false);
    // 5b 放行的英文主导混合文本在 zh 目标下同样拦截
    expect(zh.shouldTranslate("Auto-save 自动保存")).toBe(false);
    // 纯英文原文照常放行
    expect(zh.shouldTranslate("Open Settings")).toBe(true);
    expect(zh.shouldTranslate("Best plugin ever")).toBe(true);
  });

  it("规则 5c：非 zh 目标不启用（保持 5b 原行为）；setTargetLang 热切换生效", () => {
    const en = new FilterEngine([], "en");
    expect(en.shouldTranslate("Auto-save 自动保存")).toBe(true); // 5b 放行
    expect(en.shouldTranslate("重新加载 Obsidian（不保存当前编辑内容）")).toBe(false); // 5b 拦截
    // 热切换到 zh 后 5c 立即生效（配置热生效链路）
    en.setTargetLang("zh-Hant");
    expect(en.shouldTranslate("Auto-save 自动保存")).toBe(false);
    en.setTargetLang("ja");
    expect(en.shouldTranslate("Auto-save 自动保存")).toBe(true);
  });
});

describe("FilterEngine 占位符保护（规则 6）", () => {
  it("提取 {0}、%s、{{var}} 三类占位符", () => {
    expect(FilterEngine.extractPlaceholders("{0} items")).toEqual(["{0}"]);
    expect(FilterEngine.extractPlaceholders("%s done")).toEqual(["%s"]);
    expect(FilterEngine.extractPlaceholders("Hello {{name}}")).toEqual(["{{name}}"]);
    expect(FilterEngine.extractPlaceholders("No placeholder")).toEqual([]);
  });

  it("保护-还原往返等于原文", () => {
    const original = "Delete {0} files in %s?";
    const { masked, tokens } = FilterEngine.protectPlaceholders(original);
    expect(masked).not.toContain("{0}");
    expect(masked).not.toContain("%s");
    expect(FilterEngine.restorePlaceholders(masked, tokens)).toBe(original);
  });

  it("译后校验：占位符被 LLM 吃掉时判定不一致（设计文档测试用例 10）", () => {
    // "{0} items" 被译为「个项目」（占位符丢失）
    expect(FilterEngine.placeholdersIntact("{0} items", "个项目")).toBe(false);
    // 正常译文：占位符保留
    expect(FilterEngine.placeholdersIntact("{0} items", "{0} 个项目")).toBe(true);
  });
});

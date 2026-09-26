import { describe, expect, it } from "vitest";
import { buildUiTranslationPrompt, OpenAIProvider } from "../src/providers/openai-provider";
import { HttpClient, HttpRequest } from "../src/providers/base-provider";

/**
 * 1.4 Prompt Profile（设计三节，批次二）：
 * 规则 1 按 PROMPT_RULE1 语言族表取措辞（键集与措辞照设计三节逐字），
 * 未知语言回退 PROMPT_RULE1_DEFAULT；规则 6 保持通用措辞；
 * 合批 prompt 追加编号行规则并自动继承规则 1 变化。
 */

function captureHttp(content: string): { http: HttpClient; seen: { req?: HttpRequest } } {
  const seen: { req?: HttpRequest } = {};
  const http: HttpClient = async (req) => {
    seen.req = req;
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) };
  };
  return { http, seen };
}

describe("Prompt Profile：规则 1 按语言族取措辞", () => {
  // 特征词断言：每语言命中各自条目（措辞与设计三节逐字一致）
  const cases: Array<[string, string]> = [
    ["zh", "6 Chinese characters"],
    ["zh-CN", "6 Chinese characters"], // 前缀归一（scriptFamilyOf）
    ["zh-Hant", "6 Chinese characters"],
    ["ja", "6 Japanese characters"],
    ["ko", "8 Korean characters"],
    ["fr", "avoid redundant articles"],
    ["es", "avoid redundant articles"],
    ["de", "compact compound nouns"],
    ["ar", "standard Arabic UI punctuation"],
  ];
  for (const [lang, feature] of cases) {
    it(`${lang} → 含特征词「${feature}」`, () => {
      expect(buildUiTranslationPrompt(lang)).toContain(`1. Keep it concise`);
      expect(buildUiTranslationPrompt(lang)).toContain(feature);
    });
  }

  it("fr 不命中 zh 表（拉丁语系措辞独立）", () => {
    expect(buildUiTranslationPrompt("fr")).not.toContain("Chinese characters");
  });

  it("规则 2–5 保持原样；规则 6 保持通用措辞（按 targetLang 模板化，无语言特例）", () => {
    const p = buildUiTranslationPrompt("fr");
    expect(p).toContain("2. Preserve placeholders exactly: {0}, %s, {{variable}}");
    expect(p).toContain("3. Preserve keyboard shortcuts exactly: Ctrl+P, Cmd+Shift+S");
    expect(p).toContain("4. Preserve brand names, plugin names and proper nouns");
    expect(p).toContain("5. Return ONLY the translation, no explanations");
    expect(p).toContain("6. If already in fr, return as-is");
    expect(buildUiTranslationPrompt("ja")).toContain("6. If already in ja, return as-is");
  });
});

describe("Prompt Profile：未知语言回退 DEFAULT", () => {
  it("xx 回退 PROMPT_RULE1_DEFAULT，不含任何语言族特有措辞", () => {
    const p = buildUiTranslationPrompt("xx");
    expect(p).toContain("1. Keep it concise (menu/command labels as short as possible)");
    expect(p).not.toContain("Chinese characters");
    expect(p).not.toContain("articles");
    expect(p).not.toContain("compound nouns");
    expect(p).not.toContain("Arabic UI punctuation");
  });

  it("pt-BR（拉丁语系、无表项）与空串同样回退 DEFAULT", () => {
    expect(buildUiTranslationPrompt("pt-BR")).toContain("as short as possible");
    expect(buildUiTranslationPrompt("")).toContain("as short as possible");
  });
});

describe("Prompt Profile：合批 prompt 继承规则 1 并追加编号行规则", () => {
  it("translateBatch 的 system prompt 含 Batch rules 编号行规则，且规则 1 随语言族变化", async () => {
    const { http, seen } = captureHttp("1. ウェブページを開く");
    const p = new OpenAIProvider(http, { apiKey: "k", targetLang: "ja" });
    await p.translateBatch(["Open web page"]);
    const system = JSON.parse(seen.req!.body!).messages[0].content as string;
    expect(system).toContain("Batch rules:");
    expect(system).toContain("numbered lines. Translate each line separately.");
    expect(system).toContain('each prefixed with its number like "1. "');
    expect(system).toContain("Do not merge, split, or omit lines.");
    // 合批基于 buildUiTranslationPrompt 追加 → 规则 1 自动继承（ja 表项）
    expect(system).toContain("6 Japanese characters");
  });
});

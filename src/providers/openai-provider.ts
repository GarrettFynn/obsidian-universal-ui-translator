import { HttpClient, TranslationProvider } from "./base-provider";
import { scriptFamilyOf } from "../filters/filter-engine";
import { t } from "../i18n";
import type { TokenUsage } from "../types";

/**
 * 1.4 Prompt Profile（设计三节）：规则 1 按语言族的简洁性规则表。
 * zh/ja/ko/ar 经 scriptFamilyOf（过滤器导出的共享前缀匹配）归一取行；
 * fr/es/de 等拉丁语系无脚本区间（scriptFamilyOf 返回 null），按语言主码前缀
 * 匹配本表（设计 3.1"复用前缀匹配思路"）；两者都未命中走 PROMPT_RULE1_DEFAULT。
 * 拉丁语系的重译防线完全依赖规则 6（已本地化原样返回，通用措辞不动）。
 */
const PROMPT_RULE1: Readonly<Record<string, string>> = {
  zh: "Keep it concise (menu/command labels ≤ 6 Chinese characters when possible)",
  ja: "Keep it concise (menu/command labels ≤ 6 Japanese characters; prefer standard kanji UI terms)",
  ko: "Keep it concise (menu/command labels ≤ 8 Korean characters)",
  fr: "Keep it concise (avoid redundant articles; keep menu/command labels short)",
  es: "Keep it concise (avoid redundant articles; keep menu/command labels short)",
  de: "Keep it concise (prefer compact compound nouns; keep labels short)",
  ar: "Keep it concise and use standard Arabic UI punctuation",
};
const PROMPT_RULE1_DEFAULT = "Keep it concise (menu/command labels as short as possible)";

/** 规则 1 措辞解析：语言族表 → 语言主码 → DEFAULT 回退 */
function resolveRule1(targetLang: string): string {
  const family = scriptFamilyOf(targetLang);
  if (family !== null && PROMPT_RULE1[family]) return PROMPT_RULE1[family];
  const primary = targetLang.trim().toLowerCase().split("-")[0];
  return PROMPT_RULE1[primary] ?? PROMPT_RULE1_DEFAULT;
}

/** 设计文档 4.3.3 提示词模板（OpenAI / Custom 共用）；1.4 规则 1 改查 PROMPT_RULE1 族表 */
export function buildUiTranslationPrompt(targetLang: string): string {
  return [
    `You are a UI localization expert. Translate the following interface text into ${targetLang}.`,
    "Rules:",
    `1. ${resolveRule1(targetLang)}`,
    "2. Preserve placeholders exactly: {0}, %s, {{variable}}",
    "3. Preserve keyboard shortcuts exactly: Ctrl+P, Cmd+Shift+S",
    "4. Preserve brand names, plugin names and proper nouns",
    "5. Return ONLY the translation, no explanations",
    `6. If already in ${targetLang}, return as-is`,
  ].join("\n");
}

/** A1 合批：可进批的单条上限（字符）——超长或多行文本走单条通道（行结构保护） */
const BATCH_MAX_ITEM_CHARS = 200;

/**
 * A1 合批响应解析：编号行还原为按序数组
 * 严格校验——提取出的序号集合必须恰好为 {1..n}，格式/序号/行数任一违例抛错，
 * 由 BatchTranslator 既有的"批量失败 → 拆单条重试"路径兜底（上游零改动）
 */
export function parseNumberedResponse(raw: string, n: number): string[] {
  const out = new Array<string>(n);
  const seen = new Set<number>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue; // 首尾空白行忽略
    const m = /^(\d+)[.:)]?\s?(.*)$/.exec(line);
    if (!m) throw new Error(t("provider.openai.batch-line-invalid", { n: line.slice(0, 40) }));
    const idx = Number(m[1]);
    if (idx < 1 || idx > n || seen.has(idx)) throw new Error(t("provider.openai.batch-index-misaligned"));
    seen.add(idx);
    out[idx - 1] = m[2];
  }
  if (seen.size !== n) {
    throw new Error(t("provider.openai.batch-count-mismatch", { seen: seen.size, total: n }));
  }
  return out;
}

export interface OpenAIProviderOptions {
  apiKey: string;
  targetLang: string;
  /** 自定义 Base URL（可接本地模型，如 http://localhost:11434/v1），默认 https://api.openai.com/v1 */
  baseUrl?: string;
  /** 默认 gpt-4o-mini（设计文档 9.3.2 低成本档） */
  model?: string;
  /** R-34：注入 thinking:{type:"disabled"}——DeepSeek V4 等默认开启思考的模型，UI 短文本无需推理 */
  disableThinking?: boolean;
  /** v1.3：响应携带 usage 字段时回传真实账单口径 token（合批一次回调即整批消耗）；
   *  网关缺 usage / 字段非数字时静默跳过（不估算） */
  onUsage?: (u: TokenUsage) => void;
}

/** OpenAI 兼容 chat/completions 响应载荷（choices 与可选 usage） */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/** OpenAI 兼容 chat/completions 端点（设计文档 4.3.2） */
export class OpenAIProvider extends TranslationProvider {
  readonly id = "openai";
  /** 1.4 批次五：name 改 t()（构造期解析，随 refreshRuntime 重建热生效） */
  readonly name = t("provider.openai.name");
  /** A1 合批：单请求可承载条数（上游 BatchTranslator 每批 ≤50 条，40 留解析余量） */
  readonly maxBatchSize = 40;

  private baseUrl: string;
  private model: string;

  constructor(http: HttpClient, private options: OpenAIProviderOptions) {
    super(http);
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.model = options.model ?? "gpt-4o-mini";
  }

  get modelId(): string {
    return this.model;
  }

  /** v1.3：响应携带 usage 时回传真实 token（缺字段/非数字静默跳过，不估算） */
  private emitUsage(data: ChatCompletionResponse): void {
    const sink = this.options.onUsage;
    if (!sink) return;
    const p = data.usage?.prompt_tokens;
    const c = data.usage?.completion_tokens;
    if (typeof p === "number") {
      sink({ promptTokens: p, completionTokens: typeof c === "number" ? c : 0 });
    }
  }

  async translate(text: string, ctx?: { context?: string }): Promise<string> {
    if (!this.http) throw new Error(t("provider.http-not-injected"));
    const messages = [
      { role: "system", content: buildUiTranslationPrompt(this.options.targetLang) },
      // D7：context 仅作 prompt 参考，不进缓存键
      ...(ctx?.context ? [{ role: "user", content: `Context: ${ctx.context}` }] : []),
      { role: "user", content: text },
    ];
    const res = await this.http({
      url: `${this.baseUrl}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages,
        // R-34：思考模式默认开启的模型（DeepSeek V4 系列）会拖慢并放大计费，按需关闭
        ...(this.options.disableThinking ? { thinking: { type: "disabled" } } : {}),
      }),
    });
    if (res.status !== 200) {
      throw new Error(`OpenAI HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const data = JSON.parse(res.text) as ChatCompletionResponse;
    this.emitUsage(data);
    const out = data.choices?.[0]?.message?.content;
    if (typeof out !== "string" || !out.trim()) {
      throw new Error(t("provider.openai.missing-content"));
    }
    return out.trim();
  }

  /**
   * A1 合批（综合改进设计 2.1）：单行且 ≤200 字符的条目编号成列表一次请求；
   * 多行/超长条目走单条 translate（失败隔离——catch 后留空槽，由上游
   * BatchTranslator.runBatch 对空槽逐条重试，不让个别失败拖垮整批结果）。
   * 编号批响应解析失败即抛错（runBatch 整批降级拆单）。context 为 D7"仅
   * prompt 参考"维度，批内不携带（单条通道不受影响）
   */
  async translateBatch(texts: string[]): Promise<string[]> {
    if (!this.http) throw new Error(t("provider.http-not-injected"));
    if (texts.length === 0) return [];
    // 空槽语义：undefined 位在 runBatch 中触发该条的单条重试（results?.[i] ?? null）
    const out: Array<string | undefined> = new Array<string | undefined>(texts.length);
    const batchIdx: number[] = [];
    const singleIdx: number[] = [];
    texts.forEach((t, i) => {
      if (t.length > 0 && t.length <= BATCH_MAX_ITEM_CHARS && !t.includes("\n")) {
        batchIdx.push(i);
      } else {
        singleIdx.push(i);
      }
    });
    const singles = singleIdx.map(async (i) => {
      try {
        out[i] = await this.translate(texts[i]);
      } catch {
        // 单条失败留空槽，交由上游逐条重试路径处理
      }
    });
    if (batchIdx.length > 0) {
      const lines = batchIdx.map((i) => texts[i]);
      const results = await this.translateNumbered(lines);
      batchIdx.forEach((orig, k) => {
        out[orig] = results[k];
      });
    }
    await Promise.all(singles);
    return out as string[];
  }

  /** 编号列表单请求翻译（A1）；解析违例抛错走整批降级 */
  private async translateNumbered(lines: string[]): Promise<string[]> {
    if (!this.http) throw new Error(t("provider.http-not-injected"));
    const system =
      buildUiTranslationPrompt(this.options.targetLang) +
      [
        "",
        "Batch rules:",
        `- The user message contains ${lines.length} numbered lines. Translate each line separately.`,
        `- Return EXACTLY ${lines.length} lines, each prefixed with its number like "1. ", in the same order.`,
        "- Do not merge, split, or omit lines. Apply all rules above to every line.",
      ].join("\n");
    const res = await this.http({
      url: `${this.baseUrl}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        // 防部分网关默认输出上限截断批响应（截断 → 解析失败 → 长期降级逐条）
        max_tokens: 4096,
        messages: [
          { role: "system", content: system },
          { role: "user", content: lines.map((t, i) => `${i + 1}. ${t}`).join("\n") },
        ],
        // R-34：思考模式默认开启的模型（DeepSeek V4 系列）会拖慢并放大计费，按需关闭
        ...(this.options.disableThinking ? { thinking: { type: "disabled" } } : {}),
      }),
    });
    if (res.status !== 200) {
      throw new Error(`OpenAI HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const data = JSON.parse(res.text) as ChatCompletionResponse;
    this.emitUsage(data);
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(t("provider.openai.missing-content"));
    }
    return parseNumberedResponse(content.trim(), lines.length);
  }

  /** 连通性测试：真实试译一个词（/models 浅探测测不出模型名错误与账户欠费 402，R-33 教训） */
  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    if (!this.http) return { ok: false, message: t("provider.http-not-injected") };
    try {
      const out = await this.translate("OK");
      return {
        ok: true,
        message: t("provider.openai.connect-ok", { model: this.model, probe: out.slice(0, 20) }),
      };
    } catch (e) {
      const msg = String(e);
      if (/HTTP 40[13]/.test(msg))
        return { ok: false, message: t("provider.openai.auth-failed") };
      if (/HTTP 402/.test(msg))
        return { ok: false, message: t("provider.openai.insufficient-balance") };
      if (/HTTP 404/.test(msg))
        return {
          ok: false,
          message: t("provider.openai.model-not-found", { model: this.model }),
        };
      if (/HTTP 429/.test(msg)) return { ok: false, message: t("provider.openai.rate-limited") };
      return { ok: false, message: t("provider.validate-failed", { n: msg.slice(0, 150) }) };
    }
  }
}

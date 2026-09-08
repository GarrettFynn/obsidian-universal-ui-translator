import { HttpClient, TranslationProvider } from "./base-provider";

/** 设计文档 4.3.3 提示词模板（OpenAI / Custom 共用） */
export function buildUiTranslationPrompt(targetLang: string): string {
  return [
    `You are a UI localization expert. Translate the following interface text into ${targetLang}.`,
    "Rules:",
    "1. Keep it concise (menu/command labels ≤ 6 Chinese characters when possible)",
    "2. Preserve placeholders exactly: {0}, %s, {{variable}}",
    "3. Preserve keyboard shortcuts exactly: Ctrl+P, Cmd+Shift+S",
    "4. Preserve brand names, plugin names and proper nouns",
    "5. Return ONLY the translation, no explanations",
    `6. If already in ${targetLang}, return as-is`,
  ].join("\n");
}

export interface OpenAIProviderOptions {
  apiKey: string;
  targetLang: string;
  /** 自定义 Base URL（可接本地模型，如 http://localhost:11434/v1），默认 https://api.openai.com/v1 */
  baseUrl?: string;
  /** 默认 gpt-4o-mini（设计文档 9.3.2 低成本档） */
  model?: string;
}

/** OpenAI 兼容 chat/completions 端点（设计文档 4.3.2） */
export class OpenAIProvider extends TranslationProvider {
  readonly id = "openai";
  readonly name = "OpenAI 兼容接口";
  readonly maxBatchSize = 1;

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

  async translate(text: string, ctx?: { context?: string }): Promise<string> {
    if (!this.http) throw new Error("HttpClient 未注入");
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
      body: JSON.stringify({ model: this.model, temperature: 0, messages }),
    });
    if (res.status !== 200) {
      throw new Error(`OpenAI HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const data = JSON.parse(res.text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const out = data.choices?.[0]?.message?.content;
    if (typeof out !== "string" || !out.trim()) {
      throw new Error("OpenAI 响应缺少 choices[0].message.content");
    }
    return out.trim();
  }

  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    if (!this.http) return { ok: false, message: "HttpClient 未注入" };
    try {
      const res = await this.http({
        url: `${this.baseUrl}/models`,
        method: "GET",
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
      });
      if (res.status === 200) {
        return { ok: true, message: `连接成功（模型：${this.model}）` };
      }
      return { ok: false, message: `HTTP ${res.status}：请检查 API Key 与 Base URL` };
    } catch (e) {
      return { ok: false, message: `网络错误：${String(e)}` };
    }
  }
}

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
  /** R-34：注入 thinking:{type:"disabled"}——DeepSeek V4 等默认开启思考的模型，UI 短文本无需推理 */
  disableThinking?: boolean;
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
    const data = JSON.parse(res.text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const out = data.choices?.[0]?.message?.content;
    if (typeof out !== "string" || !out.trim()) {
      throw new Error("OpenAI 响应缺少 choices[0].message.content");
    }
    return out.trim();
  }

  /** 连通性测试：真实试译一个词（/models 浅探测测不出模型名错误与账户欠费 402，R-33 教训） */
  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    if (!this.http) return { ok: false, message: "HttpClient 未注入" };
    try {
      const out = await this.translate("OK");
      return { ok: true, message: `连接成功（模型：${this.model}，试译：${out.slice(0, 20)}）` };
    } catch (e) {
      const msg = String(e);
      if (/HTTP 40[13]/.test(msg)) return { ok: false, message: "API Key 无效或已失效（401/403）" };
      if (/HTTP 402/.test(msg)) return { ok: false, message: "账户余额不足（402），请到服务商后台充值或续费" };
      if (/HTTP 404/.test(msg)) return { ok: false, message: `模型不存在（404）：请检查模型名「${this.model}」` };
      if (/HTTP 429/.test(msg)) return { ok: false, message: "触发限流（429），请稍后重试" };
      return { ok: false, message: `连通性测试失败：${msg.slice(0, 150)}` };
    }
  }
}

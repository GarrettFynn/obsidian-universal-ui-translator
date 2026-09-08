import { HttpClient, HttpRequest, TranslationProvider } from "./base-provider";
import { buildUiTranslationPrompt } from "./openai-provider";

export interface CustomProviderOptions {
  targetLang: string;
  /** 端点 URL，如 http://localhost:11434/v1/chat/completions */
  endpoint: string;
  /**
   * 请求体模板，支持占位符 {{text}} {{targetLang}} {{model}}。
   * 留空则使用 OpenAI 兼容 chat 模板（要求已配置 model）。
   * 注意：模板中应为占位符加好引号（如 {"q":"{{text}}"}），本类做 JSON 转义
   */
  requestTemplate?: string;
  /** 响应提取路径，点分隔、数字段为数组下标，如 choices.0.message.content */
  responsePath?: string;
  model?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

/** 模板替换：值按 JSON 字符串内容转义后嵌入 */
function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const escaped = JSON.stringify(v).slice(1, -1);
    out = out.split(`{{${k}}}`).join(escaped);
  }
  return out;
}

/** 点路径提取：数字段按数组下标处理 */
export function extractByPath(data: unknown, path: string): string | null {
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) {
      cur = cur[Number(seg)];
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return typeof cur === "string" ? cur : null;
}

/** 自定义 HTTP 端点（设计文档 4.3.2 Custom：兼容 Ollama / LM Studio 等本地模型，零成本） */
export class CustomProvider extends TranslationProvider {
  readonly id = "custom";
  readonly name = "自定义端点";
  readonly maxBatchSize = 1;

  constructor(http: HttpClient, private options: CustomProviderOptions) {
    super(http);
  }

  get modelId(): string {
    return this.options.model ?? "";
  }

  async translate(text: string, ctx?: { context?: string }): Promise<string> {
    if (!this.http) throw new Error("HttpClient 未注入");
    const req = this.buildRequest(text, ctx);
    const res = await this.http(req);
    if (res.status !== 200) {
      throw new Error(`Custom HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const out = extractByPath(JSON.parse(res.text), this.options.responsePath ?? "choices.0.message.content");
    if (!out || !out.trim()) {
      throw new Error(`Custom 响应按路径 ${this.options.responsePath} 未提取到译文`);
    }
    return out.trim();
  }

  private buildRequest(text: string, ctx?: { context?: string }): HttpRequest {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.options.headers ?? {}),
    };
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }
    let body: string;
    if (this.options.requestTemplate) {
      body = fillTemplate(this.options.requestTemplate, {
        text,
        targetLang: this.options.targetLang,
        model: this.options.model ?? "",
      });
    } else {
      body = JSON.stringify({
        model: this.options.model ?? "",
        temperature: 0,
        messages: [
          { role: "system", content: buildUiTranslationPrompt(this.options.targetLang) },
          ...(ctx?.context ? [{ role: "user", content: `Context: ${ctx.context}` }] : []),
          { role: "user", content: text },
        ],
      });
    }
    return { url: this.options.endpoint, method: "POST", headers, body };
  }

  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    try {
      const out = await this.translate("Hello");
      return out
        ? { ok: true, message: `连接成功（试译：${out.slice(0, 20)}）` }
        : { ok: false, message: "响应为空，请检查响应路径配置" };
    } catch (e) {
      return { ok: false, message: `连通性测试失败：${String(e)}` };
    }
  }
}

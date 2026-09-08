import { HttpClient, TranslationProvider } from "./base-provider";

export interface DeepLProviderOptions {
  apiKey: string;
  targetLang: string;
}

/** DeepL 语言代码映射：zh-CN → ZH-HANS，zh-Hant → ZH-HANT，其余大写直传 */
export function toDeepLLang(targetLang: string): string {
  const norm = targetLang.toLowerCase();
  if (norm === "zh-cn" || norm === "zh-hans") return "ZH-HANS";
  if (norm === "zh-tw" || norm === "zh-hant") return "ZH-HANT";
  return targetLang.toUpperCase();
}

/**
 * DeepL（设计文档 4.3.2：界面短文本质量高）
 * - Free/Pro 端点自动识别：Free 版 Key 以 ":fx" 结尾
 * - 原生批量：单次请求携带多条 text（4.2.2 批量通道直接受益）
 * - 无模型维度：modelId 为空串（缓存键维度不受影响）
 */
export class DeepLProvider extends TranslationProvider {
  readonly id = "deepl";
  readonly name = "DeepL";
  readonly maxBatchSize = 50;

  private baseUrl: string;

  constructor(http: HttpClient, private options: DeepLProviderOptions) {
    super(http);
    this.baseUrl = options.apiKey.endsWith(":fx")
      ? "https://api-free.deepl.com"
      : "https://api.deepl.com";
  }

  get modelId(): string {
    return "";
  }

  async translate(text: string): Promise<string> {
    return (await this.translateBatch([text]))[0];
  }

  async translateBatch(texts: string[]): Promise<string[]> {
    if (!this.http) throw new Error("HttpClient 未注入");
    if (texts.length === 0) return [];
    const res = await this.http({
      url: `${this.baseUrl}/v2/translate`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DeepL-Auth-Key ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        text: texts,
        target_lang: toDeepLLang(this.options.targetLang),
      }),
    });
    if (res.status !== 200) {
      throw new Error(`DeepL HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const data = JSON.parse(res.text) as { translations?: Array<{ text?: string }> };
    if (!data.translations || data.translations.length !== texts.length) {
      throw new Error("DeepL 响应 translations 数量与请求不符");
    }
    return data.translations.map((t, i) => {
      if (typeof t.text !== "string" || !t.text) {
        throw new Error(`DeepL 响应第 ${i} 条缺少 text`);
      }
      return t.text;
    });
  }

  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    if (!this.http) return { ok: false, message: "HttpClient 未注入" };
    try {
      const res = await this.http({
        url: `${this.baseUrl}/v2/usage`,
        method: "GET",
        headers: { Authorization: `DeepL-Auth-Key ${this.options.apiKey}` },
      });
      if (res.status === 200) {
        return { ok: true, message: "连接成功（DeepL 用量查询正常）" };
      }
      return { ok: false, message: `HTTP ${res.status}：请检查 API Key` };
    } catch (e) {
      return { ok: false, message: `网络错误：${String(e)}` };
    }
  }
}

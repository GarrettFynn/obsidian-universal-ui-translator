import { HttpClient, TranslationProvider } from "./base-provider";

export interface GoogleProviderOptions {
  apiKey: string;
  targetLang: string;
}

/** Google v2 语言代码：zh-Hant 映射 zh-TW，其余直传 */
export function toGoogleLang(targetLang: string): string {
  if (targetLang.toLowerCase() === "zh-hant") return "zh-TW";
  return targetLang;
}

/** Google 响应 translatedText 为 HTML 转义文本，需还原（&amp; 最后处理避免二次解码） */
export function htmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Google Cloud Translation（设计文档 4.3.2：语言覆盖最广；原生批量 q 数组） */
export class GoogleProvider extends TranslationProvider {
  readonly id = "google";
  readonly name = "Google Cloud Translation";
  readonly maxBatchSize = 128;

  constructor(http: HttpClient, private options: GoogleProviderOptions) {
    super(http);
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
      url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.options.apiKey)}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: texts,
        target: toGoogleLang(this.options.targetLang),
        format: "text",
      }),
    });
    if (res.status !== 200) {
      throw new Error(`Google HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const data = JSON.parse(res.text) as {
      data?: { translations?: Array<{ translatedText?: string }> };
    };
    const translations = data.data?.translations;
    if (!translations || translations.length !== texts.length) {
      throw new Error("Google 响应 translations 数量与请求不符");
    }
    return translations.map((t, i) => {
      if (typeof t.translatedText !== "string" || !t.translatedText) {
        throw new Error(`Google 响应第 ${i} 条缺少 translatedText`);
      }
      return htmlUnescape(t.translatedText);
    });
  }

  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    try {
      const out = await this.translate("Hello");
      return out
        ? { ok: true, message: `连接成功（试译：${out.slice(0, 20)}）` }
        : { ok: false, message: "响应为空，请检查 API Key" };
    } catch (e) {
      return { ok: false, message: `连通性测试失败：${String(e)}` };
    }
  }
}

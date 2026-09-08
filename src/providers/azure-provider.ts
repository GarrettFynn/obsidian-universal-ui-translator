import { HttpClient, TranslationProvider } from "./base-provider";

export interface AzureProviderOptions {
  apiKey: string;
  region: string;
  targetLang: string;
}

/** Azure 语言代码：zh-CN → zh-Hans，其余直传（Azure 原生支持 zh-Hant） */
export function toAzureLang(targetLang: string): string {
  if (targetLang.toLowerCase() === "zh-cn") return "zh-Hans";
  return targetLang;
}

/** Azure Translator（设计文档 4.3.2：免费额度最大方；Key + Region 认证；原生批量） */
export class AzureProvider extends TranslationProvider {
  readonly id = "azure";
  readonly name = "Azure Translator";
  readonly maxBatchSize = 100;

  constructor(http: HttpClient, private options: AzureProviderOptions) {
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
      url: `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(toAzureLang(this.options.targetLang))}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": this.options.apiKey,
        "Ocp-Apim-Subscription-Region": this.options.region,
      },
      body: JSON.stringify(texts.map((t) => ({ Text: t }))),
    });
    if (res.status !== 200) {
      throw new Error(`Azure HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const data = JSON.parse(res.text) as Array<{
      translations?: Array<{ text?: string }>;
    }>;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error("Azure 响应条数与请求不符");
    }
    return data.map((item, i) => {
      const out = item.translations?.[0]?.text;
      if (typeof out !== "string" || !out) {
        throw new Error(`Azure 响应第 ${i} 条缺少 translations[0].text`);
      }
      return out;
    });
  }

  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    try {
      const out = await this.translate("Hello");
      return out
        ? { ok: true, message: `连接成功（试译：${out.slice(0, 20)}）` }
        : { ok: false, message: "响应为空，请检查 Key 与 Region" };
    } catch (e) {
      return { ok: false, message: `连通性测试失败：${String(e)}` };
    }
  }
}

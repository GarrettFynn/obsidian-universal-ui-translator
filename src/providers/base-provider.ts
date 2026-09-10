/**
 * Provider 统一抽象（设计文档 4.3.1）
 * - HTTP 约定：所有 Provider 的网络请求统一走 HttpClient 抽象——真实环境由装配层
 *   对接 Obsidian requestUrl（规避 CORS、符合审核规范），单元测试注入 mock
 * - translateBatch 默认实现：受控并发逐条翻译；支持原生批量的子类覆盖
 */
export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  text: string;
}

/** 真实环境适配：`(req) => requestUrl(req).then((r) => ({ status: r.status, text: r.text }))` */
export type HttpClient = (req: HttpRequest) => Promise<HttpResponse>;

/** 单请求超时包装（4.2.2 / R-23）：超时 reject，由调用方按失败处理（负缓存/熔断） */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "请求"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms)
    ),
  ]);
}

export abstract class TranslationProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly maxBatchSize: number;

  constructor(protected http?: HttpClient) {}

  abstract translate(text: string, ctx?: { context?: string }): Promise<string>;

  /** 默认实现：受控并发（上限 3）逐条翻译，保持返回顺序与输入一致 */
  async translateBatch(texts: string[]): Promise<string[]> {
    const limit = 3;
    const out: string[] = new Array(texts.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, texts.length) }, async () => {
      while (i < texts.length) {
        const cur = i++;
        out[cur] = await this.translate(texts[cur]);
      }
    });
    await Promise.all(workers);
    return out;
  }

  abstract validateConfig(): Promise<{ ok: boolean; message: string }>;
}

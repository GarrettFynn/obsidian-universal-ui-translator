/**
 * Provider 统一抽象（设计文档 4.3.1）
 * - HTTP 约定：所有 Provider 的网络请求统一走 HttpClient 抽象——真实环境由装配层
 *   对接 Obsidian requestUrl（规避 CORS、符合审核规范），单元测试注入 mock
 * - translateBatch 默认实现：全量并发逐条翻译保序；支持原生批量的子类覆盖
 *   （真实在途上限由装配层 http 信号量统一封顶，A2）
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

  /**
   * 默认实现：全量并发逐条翻译、按下标回填保序（综合改进设计 A2）
   * 真实在途请求数由装配层 http 包装层的全局信号量统一封顶（main.ts 注入
   * maxConcurrentRequests）——本层不再自带内层并发上限，避免与外层批次并发
   * 相乘导致真实在途数失控（原实现内层硬编码 3：设置并发 5 实际 15 路）
   */
  async translateBatch(texts: string[]): Promise<string[]> {
    const out: string[] = new Array<string>(texts.length);
    await Promise.all(
      texts.map(async (t, i) => {
        out[i] = await this.translate(t);
      })
    );
    return out;
  }

  abstract validateConfig(): Promise<{ ok: boolean; message: string }>;
}

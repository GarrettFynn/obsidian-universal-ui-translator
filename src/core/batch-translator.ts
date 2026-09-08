import { TranslationProvider } from "../providers/base-provider";

export interface BatchTranslatorOptions {
  /** 聚合窗口（4.2.2：100ms，可配置 50–500ms） */
  windowMs?: number;
  /** 单批条数上限（默认 50） */
  maxBatchItems?: number;
  /** 单批字符上限（默认 4000） */
  maxBatchChars?: number;
  /** 批次并发上限（默认 3，避免触发用户 API 限流） */
  concurrency?: number;
  /** 队列深度变化回调（O-1 首译进度提示；装配层接状态栏） */
  onQueueChange?: (pending: number) => void;
}

interface PendingEntry {
  text: string;
  context?: string;
  resolve: (v: string) => void;
  reject: (e: unknown) => void;
}

/**
 * 批量聚合与并发控制（设计文档 4.2.2）
 * - 聚合窗口内文本去重后合并送译（同文本共享同一请求）
 * - 单批上限取条数/字符先达者；批次间受控并发
 * - 失败策略：批量失败 → 拆单条重试 1 次 → 仍失败 reject（由调用方负缓存/熔断，禁止无限重试）
 * - 单请求 10s 超时在装配层（requestUrl 包装）实现，本类不涉及
 */
export class BatchTranslator {
  private queue: PendingEntry[] = [];
  private byText = new Map<string, PendingEntry[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(
    private getProvider: () => TranslationProvider | null,
    private options: BatchTranslatorOptions = {}
  ) {}

  /** 提交一条文本进入聚合窗口；同窗口内相同文本去重共享结果 */
  submit(text: string, context?: string): Promise<string> {
    if (!this.getProvider()) {
      return Promise.reject(new Error("Provider 未配置"));
    }
    return new Promise<string>((resolve, reject) => {
      const entry: PendingEntry = { text, context, resolve, reject };
      const same = this.byText.get(text);
      if (same) {
        same.push(entry);
      } else {
        this.byText.set(text, [entry]);
        this.queue.push(entry);
      }
      this.schedule();
      this.options.onQueueChange?.(this.queue.length);
    });
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.windowMs ?? 100);
  }

  /** 强制结算当前窗口（测试与装配层 onunload 前使用） */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const entries = this.queue;
      const groups = this.byText;
      this.queue = [];
      this.byText = new Map();
      const provider = this.getProvider();
      if (!provider || entries.length === 0) {
        for (const e of entries) e.reject(new Error("Provider 未配置"));
        return;
      }
      const batches = this.splitBatches([...groups.keys()]);
      const concurrency = this.options.concurrency ?? 3;
      let idx = 0;
      const workers = Array.from(
        { length: Math.min(concurrency, batches.length) },
        async () => {
          while (idx < batches.length) {
            const batch = batches[idx++];
            await this.runBatch(provider, batch, groups);
          }
        }
      );
      await Promise.all(workers);
    } finally {
      this.flushing = false;
      this.options.onQueueChange?.(this.queue.length);
      // R-19 修复：在途 flush 期间到达的新提交重排窗口（否则定时器白触发后永久滞留、状态栏不归零）
      if (this.queue.length > 0) this.schedule();
    }
  }

  /** 单批上限拆分：条数或字符先达者成批（4.2.2） */
  private splitBatches(texts: string[]): string[][] {
    const maxItems = this.options.maxBatchItems ?? 50;
    const maxChars = this.options.maxBatchChars ?? 4000;
    const batches: string[][] = [];
    let cur: string[] = [];
    let curChars = 0;
    for (const t of texts) {
      if (cur.length >= maxItems || (cur.length > 0 && curChars + t.length > maxChars)) {
        batches.push(cur);
        cur = [];
        curChars = 0;
      }
      cur.push(t);
      curChars += t.length;
    }
    if (cur.length > 0) batches.push(cur);
    return batches;
  }

  /** 4xx 判定（Provider 错误消息统一含 "HTTP <status>"，4.2.2 错误分类） */
  private static isClientError(e: unknown): boolean {
    return /HTTP 4\d\d/.test(String(e));
  }

  /** 批量失败 → 拆单条重试 1 次；仍失败则 reject 该条（不无限重试） */
  private async runBatch(
    provider: TranslationProvider,
    batch: string[],
    groups: Map<string, PendingEntry[]>
  ): Promise<void> {
    let results: string[] | null = null;
    let batchError: unknown = null;
    try {
      results = await provider.translateBatch(batch);
    } catch (e) {
      // 4.2.2 错误分类：保留错误供 4xx 判定（4xx 不重试）
      batchError = e;
      results = null;
    }
    for (let i = 0; i < batch.length; i++) {
      const text = batch[i];
      const waiters = groups.get(text) ?? [];
      let value: string | null = results?.[i] ?? null;
      if (value === null) {
        // 4.2.2 错误分类：4xx（Key 失效 / 参数错误 / 超额）不重试，直接失败走负缓存/熔断
        if (batchError !== null && BatchTranslator.isClientError(batchError)) {
          for (const w of waiters) w.reject(batchError);
          continue;
        }
        try {
          value = await provider.translate(text, { context: waiters[0]?.context });
        } catch (e) {
          for (const w of waiters) w.reject(e);
          continue;
        }
      }
      for (const w of waiters) w.resolve(value);
    }
  }
}

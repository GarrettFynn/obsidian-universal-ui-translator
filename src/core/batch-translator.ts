import { TranslationProvider } from "../providers/base-provider";
import { t } from "../i18n";

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

export interface BatchStats {
  /** 本会话去重后的提交条数 */
  submitted: number;
  /** 翻译成功条数 */
  completed: number;
  /** 失败条数（含重试后仍失败） */
  failed: number;
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
  private timer: number | null = null;
  private flushing = false;
  /** 1.6.0（E1-b）：已取走结算中、尚未全部完成的条数（flush 取走 entries 时置位、
   *  F3 逐批上报点同步递减、finally 归零）。原口径 queue.length 在 flush 后立即清零，
   *  真机实测（1116-0836 复审）：dom 逐条异步预算检查把提交摊薄跨窗口，队列峰值
   *  常规时序下爬不过 30，降级结构性不触发——计入在途后，批次结算期（API 慢时
   *  可达数秒）队列深度持续 >30，触发面覆盖真实堆积场景（用户拍板 b） */
  private inflight = 0;
  private statSubmitted = 0;
  private statCompleted = 0;
  private statFailed = 0;

  constructor(
    private getProvider: () => TranslationProvider | null,
    private options: BatchTranslatorOptions = {}
  ) {}

  /** 提交一条文本进入聚合窗口；同窗口内相同文本去重共享结果 */
  submit(text: string, context?: string): Promise<string> {
    if (!this.getProvider()) {
      return Promise.reject(new Error(t("common.provider-not-configured")));
    }
    return new Promise<string>((resolve, reject) => {
      const entry: PendingEntry = { text, context, resolve, reject };
      const same = this.byText.get(text);
      if (same) {
        same.push(entry);
      } else {
        this.byText.set(text, [entry]);
        this.queue.push(entry);
        this.statSubmitted++;
      }
      this.schedule();
      this.options.onQueueChange?.(this.queue.length);
    });
  }

  /** 会话统计（v1.1.0 状态栏进度展示） */
  stats(): BatchStats {
    return {
      submitted: this.statSubmitted,
      completed: this.statCompleted,
      failed: this.statFailed,
    };
  }

  /**
   * 1.6（E1）→ 1.6.0 收尾（b 拍板）：当前待结算条数 = 聚合窗口内 queue.length +
   * 已取走在途未结算 inflight。dom 高峰降级（效率档）据此判定；计入在途使批次
   * 结算期（API 慢/堆积时）队列深度持续高于阈值，触发面覆盖真实风暴（复审发现
   * 原纯 queue 口径在逐条摊薄时序下结构性不触发，见验收报告 v1.1 §四-1）。
   * 注意装配层 must 经 this 调用期取 batcher（refreshRuntime 会重建实例），不得构造期捕获。
   */
  pendingCount(): number {
    return this.queue.length + this.inflight;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
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
      // 1.6.0（E1-b）：取走即入在途（provider 缺失早退由 finally 归零兜底）
      this.inflight = entries.length;
      const provider = this.getProvider();
      if (!provider || entries.length === 0) {
        for (const e of entries) e.reject(new Error(t("common.provider-not-configured")));
        return;
      }
      const batches = this.splitBatches([...groups.keys()], provider);
      const concurrency = this.options.concurrency ?? 3;
      // v1.3 F3：逐批上报剩余未结算条数——状态栏从"整轮 flush 冻结"变为逐批刷新；
      // 1.6.0（E1-b）：同步递减 inflight（pendingCount = queue + inflight 的在途半边）
      let remaining = entries.length;
      let idx = 0;
      const workers = Array.from(
        { length: Math.min(concurrency, batches.length) },
        async () => {
          while (idx < batches.length) {
            const batch = batches[idx++];
            await this.runBatch(provider, batch, groups);
            remaining -= batch.length;
            // 冷读守卫：任一 worker reject 会令 flush 提前进 finally（flushing=false、
            // inflight=0），存活 worker 此后不得再回写陈旧计数（否则孤儿 inflight 可致
            // 降级误锁）；flushing 标志在串行 flush 语义下即代际
            if (this.flushing) this.inflight = remaining;
            this.options.onQueueChange?.(remaining);
          }
        }
      );
      await Promise.all(workers);
    } finally {
      this.flushing = false;
      this.inflight = 0; // 1.6.0（E1-b）：任何出口（含早退/异常）归零在途计数
      this.options.onQueueChange?.(this.queue.length);
      // R-19 修复：在途 flush 期间到达的新提交重排窗口（否则定时器白触发后永久滞留、状态栏不归零）
      if (this.queue.length > 0) this.schedule();
    }
  }

  /**
   * 单批上限拆分：条数或字符先达者成批（4.2.2）
   * 条数上限取「窗口聚合上限与 Provider 声明的 maxBatchSize」的较小值（A4）——
   * 声明值是 Provider 单请求真实承载上限（如 Custom 模板单条 = 1），不得越过
   */
  private splitBatches(texts: string[], provider: TranslationProvider): string[][] {
    const maxItems = Math.min(this.options.maxBatchItems ?? 50, provider.maxBatchSize);
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
          this.statFailed++;
          for (const w of waiters) w.reject(batchError);
          continue;
        }
        try {
          value = await provider.translate(text, { context: waiters[0]?.context });
        } catch (e) {
          this.statFailed++;
          for (const w of waiters) w.reject(e);
          continue;
        }
      }
      this.statCompleted++;
      for (const w of waiters) w.resolve(value);
    }
  }
}

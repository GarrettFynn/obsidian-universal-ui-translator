/**
 * 全局并发信号量（综合改进设计 A2：maxConcurrentRequests 语义修正为"真实在途 HTTP 请求数"）
 * - FIFO 排队；limit 经 getter 动态读取——设置热生效：调小不中断在途请求，新请求按新上限排队
 * - release 采用槽位转移（队列非空时直接把槽位移交给队首等待者，active 计数不变），
 *   保证任何时序下都不超 limit；limit 动态调大时旧等待者按入队顺序陆续放行
 * - 装配点在 main.ts 的 http 包装层，单点覆盖所有引擎的所有请求形态
 */
export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private getLimit: () => number) {}

  async acquire(): Promise<void> {
    if (this.active < this.getLimit()) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // 槽位直接转移给队首等待者，active 不变
    } else {
      this.active--;
    }
  }

  /** 当前在途数（测试断言用） */
  get inFlight(): number {
    return this.active;
  }
}

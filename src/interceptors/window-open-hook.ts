/**
 * window.open 捕获钩子（v1.1.1，修复社区市场浏览器盲区）
 * 背景（CDP 实测 1.13.7）：社区插件市场浏览器是 window.open 弹出的独立窗口
 * （opener=主窗口，about:blank 起步异步构建），不在 workspace leaves / app.setting
 * 引用链内——DOM 兜底与市场按钮通道此前完全够不到它。
 * 机制：包装主窗口 window.open，捕获返回的 window，等其 document.body 有内容后回调订阅者；
 * deactivate 完整还原 window.open（红线：所有 patch 必须可还原）。
 */
export class WindowOpenHook {
  private original: typeof window.open | null = null;
  private timers = new Set<number>();

  /** @param onWindow 弹窗 document 就绪回调；返回 false 表示特征检测失败（调用方降级不启用） */
  activate(onWindow: (win: Window) => void): boolean {
    if (typeof window.open !== "function" || this.original) return this.original !== null;
    this.original = window.open;
    const self = this;
    window.open = function (
      ...args: Parameters<typeof window.open>
    ): ReturnType<typeof window.open> {
      const win = self.original!.apply(window, args);
      if (win) self.notifyWhenReady(win as Window, onWindow);
      return win;
    } as typeof window.open;
    return true;
  }

  deactivate(): void {
    if (this.original) {
      window.open = this.original;
      this.original = null;
    }
    for (const t of this.timers) window.clearInterval(t);
    this.timers.clear();
  }

  /** about:blank 起步：轮询至 body 有内容（最多 10s）；窗口关闭/跨进程不可达即停 */
  private notifyWhenReady(win: Window, onWindow: (win: Window) => void): void {
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      try {
        if (win.closed) {
          window.clearInterval(timer);
          this.timers.delete(timer);
          return;
        }
        const body = win.document?.body;
        if (body && body.childElementCount > 0) {
          window.clearInterval(timer);
          this.timers.delete(timer);
          onWindow(win);
        } else if (tries > 40) {
          window.clearInterval(timer);
          this.timers.delete(timer);
        }
      } catch {
        window.clearInterval(timer);
        this.timers.delete(timer);
      }
    }, 250);
    this.timers.add(timer);
  }
}

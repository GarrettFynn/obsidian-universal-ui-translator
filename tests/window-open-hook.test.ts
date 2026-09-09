// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { WindowOpenHook } from "../src/interceptors/window-open-hook";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WindowOpenHook（v1.1.1 window.open 弹窗纳管）", () => {
  const hooks: WindowOpenHook[] = [];
  let origOpen: typeof window.open;
  afterEach(() => {
    for (const h of hooks.splice(0)) h.deactivate();
    window.open = origOpen; // 测试桩的兜底还原
  });

  it("包装 window.open：弹窗 body 就绪后回调；deactivate 还原", async () => {
    origOpen = window.open;
    // 模拟 Obsidian 弹窗：about:blank 起步，异步写入内容（CDP 实测形态）
    const doc = document.implementation.createHTMLDocument("第三方插件");
    const fakeWin = { closed: false, document: doc } as unknown as Window;
    window.open = (() => fakeWin) as typeof window.open;
    const stubbed = window.open;

    const calls: Window[] = [];
    const hook = new WindowOpenHook();
    hooks.push(hook);
    expect(hook.activate((w) => calls.push(w))).toBe(true);
    expect(window.open).not.toBe(stubbed); // 已包装

    window.open("about:blank");
    await wait(300);
    expect(calls).toHaveLength(0); // body 尚无内容，不回调
    doc.body.innerHTML = "<div>社区插件市场</div>";
    await wait(400);
    expect(calls).toEqual([fakeWin]);

    hook.deactivate();
    expect(window.open).toBe(stubbed); // 完整还原
  });

  it("deactivate 后停止等待：晚到的内容不再触发回调", async () => {
    origOpen = window.open;
    const doc = document.implementation.createHTMLDocument("w");
    const fakeWin = { closed: false, document: doc } as unknown as Window;
    window.open = (() => fakeWin) as typeof window.open;
    const calls: Window[] = [];
    const hook = new WindowOpenHook();
    hook.activate((w) => calls.push(w));
    window.open("about:blank");
    hook.deactivate();
    doc.body.innerHTML = "<div>late</div>";
    await wait(400);
    expect(calls).toHaveLength(0);
  });
});

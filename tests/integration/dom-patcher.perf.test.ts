// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DOMPatcher } from "../../src/interceptors/dom-patcher";
import { TranslationCoordinator } from "../../src/core/coordinator";

/**
 * 性能基准下界检查（8.3 / 1.5 指标）
 * 说明：jsdom 环境只能提供下界（jsdom DOM 操作比真实浏览器慢），
 * 100 插件环境单帧 < 5ms 的正式指标以 Phase E 次批 CDP 实测为准。
 */
describe("DOMPatcher 性能下界（8.3）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("扫描入队 1000 节点（模拟 100 插件级突变风暴）耗时 < 100ms（jsdom 下界，机器浮动冗余）", () => {
    const coord = {
      translate: async (t: string) => t,
    } as unknown as TranslationCoordinator;
    const p = new DOMPatcher(coord, (t) => t, () => false);
    // 不 activate（不开 observer）：直接测量扫描入队路径（单帧预算约束的对象）
    const root = document.createElement("div");
    for (let i = 0; i < 1000; i++) {
      const d = document.createElement("div");
      d.textContent = `Command Label ${i}`;
      root.appendChild(d);
    }
    document.body.appendChild(root);
    const start = performance.now();
    (
      p as unknown as { collectTextNodes(n: Node): void }
    ).collectTextNodes(root);
    const elapsed = performance.now() - start;
    p.deactivate();
    // R-26：jsdom 下界随宿主机浮动（本地实测 52–56ms）；CI 共享 runner 慢约 2–3 倍（实测 ~152ms），
    // 预算按环境取 100/300ms，均保留数量级退化捕获能力
    const budgetMs = process.env.CI ? 300 : 100;
    expect(elapsed).toBeLessThan(budgetMs);
    console.log(`[uut-perf] collectTextNodes 1000 节点耗时 ${elapsed.toFixed(2)}ms（jsdom）`);
  });
});

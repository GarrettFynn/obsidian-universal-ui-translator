// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { MarketplacePatcher } from "../src/interceptors/marketplace-patcher";
import { TranslationCoordinator } from "../src/core/coordinator";

function makeItem(text: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "community-item";
  const name = document.createElement("div");
  name.className = "community-item-name";
  name.textContent = text;
  item.appendChild(name);
  document.body.appendChild(item);
  return item;
}

function stubCoordinator(): TranslationCoordinator {
  return { translate: async (t: string) => `译:${t}` } as unknown as TranslationCoordinator;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("MarketplacePatcher（v1.1.0 社区市场条目级「译」按钮）", () => {
  const patchers: MarketplacePatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("条目注入按钮；点击翻译该条目文本；按钮自身不被翻译；重复扫描不重复注入", async () => {
    const p = new MarketplacePatcher(stubCoordinator(), (t) => t);
    patchers.push(p);
    const item = makeItem("Super Plugin");
    expect(p.activate()).toBe(true);
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute("data-no-translate")).toBe("true");
    btn!.click();
    await tick();
    expect(item.textContent).toContain("译:Super Plugin");
    // 按钮自身文本（译/✓1）未被翻译
    expect(btn!.textContent).not.toContain("译:");
    // 幂等：再次扫描不重复注入
    (p as unknown as { injectButtons(d: Document): void }).injectButtons(document);
    expect(item.querySelectorAll(".uut-mkt-btn")).toHaveLength(1);
  });

  it("deactivate 移除全部按钮；断开后新增条目不再注入", async () => {
    const p = new MarketplacePatcher(stubCoordinator(), (t) => t);
    const item = makeItem("Another Plugin");
    p.activate();
    expect(item.querySelector(".uut-mkt-btn")).toBeTruthy();
    p.deactivate();
    expect(document.querySelector(".uut-mkt-btn")).toBeNull();
    const late = makeItem("Late Plugin");
    await tick();
    expect(late.querySelector(".uut-mkt-btn")).toBeNull();
  });
});

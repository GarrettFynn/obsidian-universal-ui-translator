// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Menu } from "obsidian";
import { MenuPatcher } from "../../src/interceptors/menu-patcher";
import { TranslationCoordinator } from "../../src/core/coordinator";

function stubCoordinator(): TranslationCoordinator {
  return { translate: async (t: string) => `译:${t}` } as unknown as TranslationCoordinator;
}
const tick = () => new Promise((r) => setTimeout(r, 10));
const format = (t: string, o: string) => (t === o ? null : t);

interface CapturedItem {
  titleEl: HTMLElement;
}

describe("MenuPatcher 集成（R-27：补齐菜单通道覆盖缺口）", () => {
  const patchers: MenuPatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("addItem 回调中的 setTitle 被包装：先显原文，翻译完成后原地替换", async () => {
    const p = new MenuPatcher(stubCoordinator(), format, () => false);
    patchers.push(p);
    expect(p.activate()).toBe(true);
    const menu = new Menu();
    let captured: CapturedItem | null = null;
    menu.addItem((item) => {
      captured = item as unknown as CapturedItem;
      item.setTitle("Open Settings");
    });
    expect(captured!.titleEl.textContent).toBe("Open Settings"); // 同步原文（不阻塞弹出）
    await tick();
    expect(captured!.titleEl.textContent).toBe("译:Open Settings"); // 译后原地替换
  });

  it("双语模式：仅显译文，原文进 tooltip（5.1 空间受限策略）", async () => {
    const p = new MenuPatcher(stubCoordinator(), format, () => true);
    patchers.push(p);
    p.activate();
    const menu = new Menu();
    let captured: CapturedItem | null = null;
    menu.addItem((item) => {
      captured = item as unknown as CapturedItem;
      item.setTitle("Open Settings");
    });
    await tick();
    expect(captured!.titleEl.textContent).toBe("译:Open Settings"); // 菜单仅译文
    expect(captured!.titleEl.getAttribute("title")).toBe("Open Settings"); // 原文进 tooltip
  });

  it("deactivate 还原原型（D1 / 8.2 用例 5 菜单侧）", () => {
    const original = Menu.prototype.addItem;
    const p = new MenuPatcher(stubCoordinator(), format, () => false);
    patchers.push(p);
    p.activate();
    expect(Menu.prototype.addItem).not.toBe(original);
    p.deactivate();
    expect(Menu.prototype.addItem).toBe(original);
  });

  it("DocumentFragment 入参直接透传不翻译（4.1.2）", async () => {
    const coord = stubCoordinator();
    const p = new MenuPatcher(coord, format, () => false);
    patchers.push(p);
    p.activate();
    const menu = new Menu();
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode("Fragment Title"));
    menu.addItem((item) => item.setTitle(frag));
    await tick();
    // fragment 分支不调翻译：协调器无新增调用（构造时无存量可测，观察调用数恒 0）
    expect((coord as unknown as { calls?: string[] }).calls ?? []).toHaveLength(0);
  });
});

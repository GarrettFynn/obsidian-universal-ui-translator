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

/** v1.1.5 详情面板测试用 DOM：.mod-community-plugin 弹窗 = .modal-content > (.modal-sidebar + 详情区) */
function makeModal(detailHtml: string): { modal: HTMLElement; detail: HTMLElement; sidebar: HTMLElement } {
  const modal = document.createElement("div");
  modal.className = "modal mod-community-modal mod-community-plugin";
  const content = document.createElement("div");
  content.className = "modal-content";
  const sidebar = document.createElement("div");
  sidebar.className = "modal-sidebar";
  sidebar.textContent = "列";
  const detail = document.createElement("div");
  detail.innerHTML = detailHtml;
  content.appendChild(sidebar);
  content.appendChild(detail);
  modal.appendChild(content);
  document.body.appendChild(modal);
  return { modal, detail, sidebar };
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

  it("adoptDocument：纳管 window.open 弹出的独立窗口 document 并注入按钮（v1.1.1 盲区修复）", () => {
    const p = new MarketplacePatcher(stubCoordinator(), (t) => t);
    patchers.push(p);
    p.activate();
    const doc = document.implementation.createHTMLDocument("第三方插件");
    doc.body.innerHTML =
      '<div class="community-item"><div class="community-item-name">Plugin X</div><div class="community-item-desc">Some desc</div></div>';
    p.adoptDocument(doc);
    expect(doc.querySelector(".uut-mkt-btn")).toBeTruthy();
    p.adoptDocument(doc); // 幂等：重复纳管不重复注入
    expect(doc.querySelectorAll(".uut-mkt-btn")).toHaveLength(1);
  });

  it("v1.1.5 嵌套修复：回写打 data-uut 标记 + 登记 onWriteBack；重复点击零送译；deactivate 清标", async () => {
    const calls: string[] = [];
    const coord = {
      translate: async (t: string) => {
        calls.push(t);
        return `译:${t}`;
      },
    } as unknown as TranslationCoordinator;
    const writtenBack: string[] = [];
    const p = new MarketplacePatcher(
      coord,
      (t) => t,
      () => {},
      undefined,
      (n: Text) => writtenBack.push(n.nodeValue ?? "")
    );
    patchers.push(p);
    const item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(item.textContent).toContain("译:Super Plugin");
    // 已译节点父元素打标；onWriteBack 逐节点登记（供 DOMPatcher 去重账本）
    const nameEl = item.querySelector(".community-item-name") as HTMLElement;
    expect(nameEl.getAttribute("data-uut")).toBe("mkt");
    expect(writtenBack.some((v) => v.includes("译:Super Plugin"))).toBe(true);
    // 重复点击：已译节点被跳过，零送译
    const callCount = calls.length;
    btn.click();
    await tick();
    expect(calls.length).toBe(callCount);
    // deactivate 清除本通道标记（不影响其他 [data-uut] 用途）
    p.deactivate();
    expect(item.querySelector('[data-uut="mkt"]')).toBeNull();
  });

  it("v1.1.5：详情面板注入「译」按钮——点击翻译 README 全文；sidebar 不受影响；代码块跳过", async () => {
    const calls: string[] = [];
    const coord = {
      translate: async (t: string) => {
        calls.push(t);
        return `译:${t}`;
      },
    } as unknown as TranslationCoordinator;
    const p = new MarketplacePatcher(coord, (t) => t);
    patchers.push(p);
    const { detail, sidebar } = makeModal(
      "<h2>Obsidian Git Plugin</h2>" +
        "<p>A powerful community plugin that brings Git integration right into your vault.</p>" +
        '<pre>git commit -m "do not translate code"</pre>'
    );
    p.activate();
    const btn = detail.querySelector(":scope > .uut-mkt-detail-btn") as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute("data-no-translate")).toBe("true");
    expect(sidebar.querySelector(".uut-mkt-detail-btn")).toBeNull(); // 按钮只在详情区
    btn!.click();
    await tick();
    expect(detail.textContent).toContain("译:A powerful community plugin");
    expect(detail.textContent).toContain("译:Obsidian Git Plugin");
    // 代码块不送译
    expect(calls.some((t) => t.includes("git commit"))).toBe(false);
    expect(detail.querySelector("pre")!.textContent).toBe('git commit -m "do not translate code"');
    // 侧栏 untouched（stub 不设过滤器，若被波及会变"译:"）
    expect(sidebar.textContent).toBe("列");
  });

  it("v1.1.5：详情区随选中插件重渲染后，按钮经观察器重注入且可翻译新内容", async () => {
    const p = new MarketplacePatcher(stubCoordinator(), (t) => t);
    patchers.push(p);
    const { detail } = makeModal("<p>First plugin description text.</p>");
    p.activate();
    expect(detail.querySelector(":scope > .uut-mkt-detail-btn")).toBeTruthy();
    // 模拟切换选中插件：详情区整棵重渲染（旧按钮与已译标记随旧节点销毁）
    detail.innerHTML = "<p>Second plugin README content here.</p>";
    await tick(); // MutationObserver → injectButtons 重注入
    const btn = detail.querySelector(":scope > .uut-mkt-detail-btn") as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    btn!.click();
    await tick();
    expect(detail.textContent).toContain("译:Second plugin README content here.");
  });

  it("v1.1.6 回归：详情区为多个并列兄弟容器时，详情按钮覆盖简介+README 正文，sidebar 不送译", async () => {
    const calls: string[] = [];
    const coord = {
      translate: async (t: string) => {
        calls.push(t);
        return `译:${t}`;
      },
    } as unknown as TranslationCoordinator;
    const p = new MarketplacePatcher(coord, (t) => t);
    patchers.push(p);
    // 复现 Obsidian 1.13.7 实测布局：简介头部与 README 正文是 .modal-content 下不同兄弟容器
    const modal = document.createElement("div");
    modal.className = "modal mod-community-modal mod-community-plugin";
    const content = document.createElement("div");
    content.className = "modal-content";
    const sidebar = document.createElement("div");
    sidebar.className = "modal-sidebar";
    sidebar.textContent = "English List Item Name"; // 侧栏英文也不应被详情按钮送译
    const header = document.createElement("div");
    header.innerHTML = "<p>Integrate Git version control with automatic backup.</p>";
    const readme = document.createElement("div");
    readme.innerHTML =
      "<h2>Key Features</h2><p>Automatic commit-and-sync on a schedule.</p><pre>git push origin main</pre>";
    content.appendChild(sidebar);
    content.appendChild(header);
    content.appendChild(readme);
    modal.appendChild(content);
    document.body.appendChild(modal);
    p.activate();
    // 按钮注入在第一个非 sidebar 容器（简介头部）顶部
    const btn = header.querySelector(":scope > .uut-mkt-detail-btn") as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    btn!.click();
    await tick();
    // 简介头部与 README 正文（兄弟容器）都被翻译
    expect(header.textContent).toContain("译:Integrate Git version control");
    expect(readme.textContent).toContain("译:Key Features");
    expect(readme.textContent).toContain("译:Automatic commit-and-sync on a schedule.");
    // 代码块与侧栏均不送译
    expect(calls.some((t) => t.includes("git push"))).toBe(false);
    expect(calls.some((t) => t.includes("English List Item Name"))).toBe(false);
    expect(sidebar.textContent).toBe("English List Item Name");
  });
});

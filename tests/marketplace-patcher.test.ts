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
  return {
    translate: async (t: string) => `译:${t}`,
    translateWithOutcome: async (t: string) => ({ text: `译:${t}`, outcome: "translated" }),
  } as unknown as TranslationCoordinator;
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
      translateWithOutcome: async (t: string) => {
        calls.push(t);
        return { text: `译:${t}`, outcome: "translated" };
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
      translateWithOutcome: async (t: string) => {
        calls.push(t);
        return { text: `译:${t}`, outcome: "translated" };
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
      translateWithOutcome: async (t: string) => {
        calls.push(t);
        return { text: `译:${t}`, outcome: "translated" };
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


describe("v1.1.8 失效感知：失败反馈 / 存活检查 / 自动重试 / 异常兜底", () => {
  const patchers: MarketplacePatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("翻译全部失败时按钮显示 × 并 Notice 说明原因（不再静默 ✓）；30 秒内同因去抖", async () => {
    const coord = {
      translateWithOutcome: async (t: string) => ({
        text: t,
        outcome: "failed" as const,
        error: "OpenAI HTTP 429: slow down",
      }),
    } as unknown as TranslationCoordinator;
    const notices: string[] = [];
    const p = new MarketplacePatcher(coord, (t) => t, () => {}, undefined, undefined, (m) =>
      notices.push(m)
    );
    patchers.push(p);
    const item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(btn.textContent).toBe("×");
    expect(btn.classList.contains("uut-mkt-btn-failed")).toBe(true);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("HTTP 429");
    expect(item.textContent).not.toContain("译:"); // 失败不回写
    // 去抖：30 秒内同因重复点击不再弹 Notice
    btn.click();
    await tick();
    expect(notices).toHaveLength(1);
  });

  it("预算超限时点击提示预算原因（此前纯静默——用户「按钮失效」观感的头号嫌疑）", async () => {
    const coord = {
      translateWithOutcome: async (t: string) => ({ text: t, outcome: "budget" as const }),
    } as unknown as TranslationCoordinator;
    const notices: string[] = [];
    const p = new MarketplacePatcher(coord, (t) => t, () => {}, undefined, undefined, (m) =>
      notices.push(m)
    );
    patchers.push(p);
    const item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(btn.textContent).toBe("×");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("预算");
  });

  it("无可译节点（全被过滤）时显示 ✓——无失败态、无 Notice", async () => {
    const coord = {
      translateWithOutcome: async (t: string) => ({ text: t, outcome: "filtered" as const }),
    } as unknown as TranslationCoordinator;
    const notices: string[] = [];
    const p = new MarketplacePatcher(coord, (t) => t, () => {}, undefined, undefined, (m) =>
      notices.push(m)
    );
    patchers.push(p);
    const item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(btn.textContent).toBe("✓");
    expect(btn.classList.contains("uut-mkt-btn-failed")).toBe(false);
    expect(notices).toHaveLength(0);
  });

  it("翻译途中节点游离则放弃回写（5.2 存活检查）；根容器仍存活时自动重试一次成功回写", async () => {
    const notices: string[] = [];
    let item!: HTMLElement;
    let firstPass = true;
    const coord = {
      translateWithOutcome: async (t: string) => {
        if (firstPass) {
          firstPass = false;
          // 模拟翻译途中详情区被重渲染：原节点（含按钮）销毁、同名原文节点重生
          item.innerHTML = '<div class="community-item-name">Super Plugin</div>';
          return { text: `译:${t}`, outcome: "translated" as const };
        }
        // 重试趟：第一趟译文已进缓存，零成本命中
        return { text: `译:${t}`, outcome: "cache" as const };
      },
    } as unknown as TranslationCoordinator;
    const p = new MarketplacePatcher(
      coord,
      (t, o) => `${t} (${o})`,
      () => {},
      undefined,
      undefined,
      (m) => notices.push(m)
    );
    patchers.push(p);
    item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    // 自动重试把重生节点回写成功——用户不再需要手动点第二次
    expect(item.textContent).toContain("译:Super Plugin");
    expect(notices).toHaveLength(0);
  });

  it("coordinator 意外抛错时按钮恢复「译」可重试（此前永久卡「…」）", async () => {
    const coord = {
      translateWithOutcome: async () => {
        throw new Error("unexpected boom");
      },
    } as unknown as TranslationCoordinator;
    const p = new MarketplacePatcher(coord, (t) => t, () => {}, undefined, undefined, () => {});
    patchers.push(p);
    const item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(btn.textContent).toBe("译");
    expect(btn.getAttribute("disabled")).toBeNull();
  });
});


describe("v1.1.8 复查补强：兄弟锁定 / 显示原文模式 / 部分游离", () => {
  const patchers: MarketplacePatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  /** 同父双文本节点条目：<p>First part <br> Second part</p>（README 段落的典型内联结构） */
  function makeTwoPartItem(): { item: HTMLElement; para: HTMLElement } {
    const item = document.createElement("div");
    item.className = "community-item";
    const para = document.createElement("p");
    para.appendChild(document.createTextNode("First part "));
    para.appendChild(document.createElement("br"));
    para.appendChild(document.createTextNode("Second part"));
    item.appendChild(para);
    document.body.appendChild(item);
    return { item, para };
  }

  it("锁定修复：同父兄弟部分失败时父元素不打标，再次点击可补全失败节点", async () => {
    let failSecond = true;
    const calls: string[] = [];
    const coord = {
      translateWithOutcome: async (t: string) => {
        calls.push(t);
        // 模拟生产环境规则 5c：已译双语产物不再送译
        if (/[\u4e00-\u9fff]/.test(t)) return { text: t, outcome: "filtered" as const };
        if (failSecond && t === "Second part") {
          return { text: t, outcome: "failed" as const, error: "boom" };
        }
        return { text: `译:${t}`, outcome: "translated" as const };
      },
    } as unknown as TranslationCoordinator;
    const notices: string[] = [];
    const p = new MarketplacePatcher(coord, (t) => t, () => {}, undefined, undefined, (m) =>
      notices.push(m)
    );
    patchers.push(p);
    const { item, para } = makeTwoPartItem();
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(para.textContent).toContain("译:First part");
    expect(para.textContent).toContain("Second part"); // 失败兄弟保持原文
    expect(btn.textContent).toBe("✓1"); // 部分成功：不显示失败态
    // 关键断言：父元素未打标（否则 TreeWalker 跳过 [data-uut] 祖先，失败节点永久锁死）
    expect(para.getAttribute("data-uut")).toBeNull();
    // 第二次点击：失败兄弟重试成功；已译兄弟被过滤不重复送译；全部成功后打标
    failSecond = false;
    btn.click();
    await tick();
    expect(para.textContent).toContain("译:Second part");
    expect(para.getAttribute("data-uut")).toBe("mkt");
    expect(calls.filter((t) => t === "译:译:First part")).toHaveLength(0); // 无嵌套重译
  });

  it("「临时显示原文」模式下点击：提示原因、按钮恢复「译」、译文已缓存但不回写", async () => {
    const coord = {
      translateWithOutcome: async (t: string) => ({
        text: `译:${t}`,
        outcome: "translated" as const,
      }),
    } as unknown as TranslationCoordinator;
    const notices: string[] = [];
    // format 恒返回 null = displayMode "original" 的回写抑制语义
    const p = new MarketplacePatcher(coord, () => null, () => {}, undefined, undefined, (m) =>
      notices.push(m)
    );
    patchers.push(p);
    const item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(btn.textContent).toBe("译"); // 中性可重试，而非伪装 ✓
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("临时显示原文");
    expect(item.querySelector(".community-item-name")!.textContent).toBe("Super Plugin");
  });

  it("部分游离自动补救：一趟内成功+游离混合时自动补一趟（缓存命中零成本），无需用户再点", async () => {
    let item!: HTMLElement;
    let rebuilt = false;
    const coord = {
      translateWithOutcome: async (t: string) => {
        if (!rebuilt && t === "Second part") {
          rebuilt = true;
          await null; // 让兄弟节点先完成回写，制造"部分成功 + 部分游离"
          const para = item.querySelector("p")!;
          para.innerHTML = "";
          para.appendChild(document.createTextNode("First part "));
          para.appendChild(document.createElement("br"));
          para.appendChild(document.createTextNode("Second part"));
          return { text: `译:${t}`, outcome: "translated" as const };
        }
        return { text: `译:${t}`, outcome: rebuilt ? ("cache" as const) : ("translated" as const) };
      },
    } as unknown as TranslationCoordinator;
    const notices: string[] = [];
    const p = new MarketplacePatcher(coord, (t) => t, () => {}, undefined, undefined, (m) =>
      notices.push(m)
    );
    patchers.push(p);
    const r = makeTwoPartItem();
    item = r.item;
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    // 第一趟 First part 回写成功、Second part 游离；自动第二趟把重生节点从缓存回写
    const para = item.querySelector("p")!;
    expect(para.textContent).toContain("译:First part");
    expect(para.textContent).toContain("译:Second part");
    expect(btn.textContent).toBe("✓3");
    expect(notices).toHaveLength(0);
  });

  it("重试一趟仍全部游离（详情区持续重渲染）时按钮回到「译」而非伪装 ✓", async () => {
    let item!: HTMLElement;
    let callCount = 0;
    const coord = {
      translateWithOutcome: async (t: string) => {
        callCount++;
        // 每趟都再重渲染一次 → 两趟回写目标全部游离
        item.innerHTML = '<div class="community-item-name">Super Plugin</div>';
        return { text: `译:${t}`, outcome: "translated" as const };
      },
    } as unknown as TranslationCoordinator;
    const notices: string[] = [];
    const p = new MarketplacePatcher(coord, (t) => t, () => {}, undefined, undefined, (m) =>
      notices.push(m)
    );
    patchers.push(p);
    item = makeItem("Super Plugin");
    p.activate();
    const btn = item.querySelector(":scope > .uut-mkt-btn") as HTMLButtonElement;
    btn.click();
    await tick();
    expect(callCount).toBe(2); // 只自动重试一趟，不死循环
    expect(btn.textContent).toBe("译");
    expect(notices).toHaveLength(0);
  });
});

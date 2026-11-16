// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DOMPatcher } from "../../src/interceptors/dom-patcher";
import { TranslationCoordinator } from "../../src/core/coordinator";

interface CoordStub {
  calls: string[];
  translate: (t: string) => Promise<string>;
  translateWithOutcome: (t: string) => Promise<{ text: string; outcome: string }>;
}

function stubCoordinator(): TranslationCoordinator {
  const calls: string[] = [];
  const stub: CoordStub = {
    calls,
    translate: async (t: string) => {
      calls.push(t);
      return `译:${t}`;
    },
    // 1.6（E2）：processNode 改走 translateWithOutcome 取 outcome——stub 同步提供；
    // 与 translate 共用 calls（processNode 只走本方法，单次计数口径不变）
    translateWithOutcome: async (t: string) => {
      calls.push(t);
      return { text: `译:${t}`, outcome: "translated" };
    },
  };
  return stub as unknown as TranslationCoordinator;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const format = (t: string, o: string) => (t === o ? null : t);

describe("DOMPatcher 集成", () => {
  const patchers: DOMPatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("新增 DOM 文本节点被翻译（MutationObserver → 空闲调度 → 回写）", async () => {
    const p = new DOMPatcher(stubCoordinator(), format, () => false);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.textContent = "Open Settings";
    document.body.appendChild(div);
    await wait(300); // jsdom 无 requestIdleCallback → setTimeout(100) 兜底
    expect(div.textContent).toBe("译:Open Settings");
  });

  it("白名单区域不译（编辑器内容区 .cm-content）", async () => {
    const p = new DOMPatcher(stubCoordinator(), format, () => false);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.className = "cm-content";
    div.textContent = "Open Settings";
    document.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("Open Settings");
  });

  it(".prompt 层不译：快速切换器的文件名/库名属用户内容（v1.1.2 冒烟 S7 暴露）", async () => {
    const p = new DOMPatcher(stubCoordinator(), format, () => false);
    patchers.push(p);
    p.activate();
    const prompt = document.createElement("div");
    prompt.className = "prompt";
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = "My Daily Note";
    prompt.appendChild(item);
    document.body.appendChild(prompt);
    await wait(300);
    expect(item.textContent).toBe("My Daily Note");
  });

  it("rescanAllText：已渲染未译节点重置记录后重新翻译（v1.1.0 配置热生效）", async () => {
    let broken = true;
    const coord = {
      // 1.6（E2）：processNode 走 translateWithOutcome——broken 时回退原文（与 coordinator 一致）
      translateWithOutcome: async (t: string) =>
        broken
          ? { text: t, outcome: "failed" as const }
          : { text: `译:${t}`, outcome: "translated" as const },
    } as unknown as TranslationCoordinator;
    const p = new DOMPatcher(coord, format, () => false);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.textContent = "Open Settings";
    document.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("Open Settings"); // 失败保持原文，且 processed 已固化
    broken = false; // 模拟用户修复配置
    p.rescanAllText();
    await wait(300);
    expect(div.textContent).toBe("译:Open Settings");
  });

  it("adoptDocument：纳管 window.open 弹窗 document 并翻译其中存量文本（v1.1.1 市场盲区修复）", async () => {
    const p = new DOMPatcher(stubCoordinator(), format, () => false);
    patchers.push(p);
    p.activate();
    const doc = document.implementation.createHTMLDocument("第三方插件");
    doc.body.innerHTML =
      '<div class="community-item"><div class="community-item-desc">Best plugin ever</div></div>';
    p.adoptDocument(doc);
    await wait(300);
    expect(doc.body.textContent).toContain("译:Best plugin ever");
    // 幂等：重复纳管不重复观察
    p.adoptDocument(doc);
    expect(doc.body.textContent).toContain("译:Best plugin ever");
  });

  it("回写不引发循环；characterData 变化后同节点新文本重新翻译（A3 口径）", async () => {
    const coord = stubCoordinator();
    const p = new DOMPatcher(coord, format, () => false);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.textContent = "First Label";
    document.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("译:First Label");
    const callsAfterFirst = (coord as unknown as CoordStub).calls.length;
    await wait(300); // 回写引发的 mutation 不再送译（回写循环抑制）
    expect((coord as unknown as CoordStub).calls.length).toBe(callsAfterFirst);
    // 节点文本被外部更新为新英文 → 重新翻译
    div.firstChild!.nodeValue = "Second Label";
    await wait(300);
    expect(div.textContent).toBe("译:Second Label");
  });

  it("R-12：popout 式独立 document 也被观察翻译（多 document observer）", async () => {
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    const fakeApp = {
      workspace: {
        iterateAllLeaves: (cb: (leaf: unknown) => void) =>
          cb({ view: { containerEl: popoutDoc.body } }),
        on: () => ({}),
        offref: () => undefined,
      },
    };
    const p = new DOMPatcher(stubCoordinator(), format, () => false, () => {}, fakeApp);
    patchers.push(p);
    p.activate();
    const div = popoutDoc.createElement("div");
    div.textContent = "Popout Label";
    popoutDoc.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("译:Popout Label");
  });

  it("R-22：设置弹窗 document 经 app.setting.modalEl 纳管并翻译", async () => {
    const popupDoc = document.implementation.createHTMLDocument("settings-popup");
    const fakeApp = {
      workspace: {
        iterateAllLeaves: (cb: (leaf: unknown) => void) => undefined,
        on: () => ({}),
        offref: () => undefined,
      },
      setting: { modalEl: popupDoc.body },
    };
    const p = new DOMPatcher(stubCoordinator(), format, () => false, () => {}, fakeApp);
    patchers.push(p);
    p.activate();
    const div = popupDoc.createElement("div");
    div.textContent = "Settings Nav Label";
    popupDoc.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("译:Settings Nav Label");
  });

  it("R-22 时序修订：设置弹窗在激活后才打开（晚到 document）经低频重扫纳管", async () => {
    const lateDoc = document.implementation.createHTMLDocument("settings-popup-late");
    const fakeSetting: { modalEl?: HTMLElement } = {}; // 激活时设置未打开
    const fakeApp = {
      workspace: {
        iterateAllLeaves: (cb: (leaf: unknown) => void) => undefined,
        on: () => ({}),
        offref: () => undefined,
      },
      setting: fakeSetting,
    };
    // 注入 50ms 重扫间隔（测试提速；生产默认 3000ms）
    const p = new DOMPatcher(stubCoordinator(), format, () => false, () => {}, fakeApp, 50);
    patchers.push(p);
    p.activate();
    // 激活之后才打开设置弹窗（E-11 复验暴露的生产时序）
    fakeSetting.modalEl = lateDoc.body;
    await wait(150); // 低频重扫纳管
    const div = lateDoc.createElement("div");
    div.textContent = "Late Settings Label";
    lateDoc.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("译:Late Settings Label");
  });

  it("R-31：纳管非主 document 时对存量文本初始扫描（无新增突变也翻译）", async () => {
    const popupDoc = document.implementation.createHTMLDocument("popup-existing");
    const div = popupDoc.createElement("div");
    div.textContent = "Existing Popup Label";
    popupDoc.body.appendChild(div); // 先于激活存在的存量文本
    const fakeApp = {
      workspace: {
        iterateAllLeaves: (cb: (leaf: unknown) => void) =>
          cb({ view: { containerEl: popupDoc.body } }),
        on: () => ({}),
        offref: () => undefined,
      },
    };
    const p = new DOMPatcher(stubCoordinator(), format, () => false, () => {}, fakeApp, 50);
    patchers.push(p);
    p.activate();
    await wait(300);
    expect(div.textContent).toBe("译:Existing Popup Label");
  });

  it("R-32：不可见节点回滚记录并延迟重试（不毒化永久 skip）", async () => {
    // jsdom 无 checkVisibility：注入可控实现，模拟弹窗打开瞬间的不可见
    const proto = HTMLElement.prototype as unknown as { checkVisibility?: () => boolean };
    let visible = false;
    proto.checkVisibility = () => visible;
    try {
      const p = new DOMPatcher(stubCoordinator(), format, () => false);
      patchers.push(p);
      p.activate();
      const div = document.createElement("div");
      div.textContent = "Deferred Label";
      document.body.appendChild(div);
      await wait(300);
      expect(div.textContent).toBe("Deferred Label"); // 不可见：未译，但记录已回滚（未毒化）
      visible = true; // 弹窗变为可见
      await wait(1600); // 1s 延迟重试命中
      expect(div.textContent).toBe("译:Deferred Label");
    } finally {
      delete proto.checkVisibility;
    }
  });

  it("v1.1.5：回写去重统一 trim 口径——带前后空白的文本回写后不再重送（嵌套乱码回归）", async () => {
    const coord = stubCoordinator();
    const p = new DOMPatcher(coord, format, () => false);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.textContent = "  Padded Label  "; // 保留前后空白：旧口径（存未 trim 值）必然误判重送
    document.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("  译:Padded Label  ");
    const callsAfterWrite = (coord as unknown as CoordStub).calls.length;
    await wait(300);
    // 回写产物（含空白）不再被当成新内容重送
    expect((coord as unknown as CoordStub).calls.length).toBe(callsAfterWrite);
    expect(div.textContent).toBe("  译:Padded Label  ");
  });

  it("v1.1.5：markWrittenBack 登记后，外部通道（市场「译」按钮）的回写不被重送", async () => {
    const coord = stubCoordinator();
    const p = new DOMPatcher(coord, format, () => false);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.textContent = "Plugin Desc";
    document.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("译:Plugin Desc");
    const before = (coord as unknown as CoordStub).calls.length;
    // 模拟 MarketplacePatcher.translateItem 的跨通道回写：外部直改 nodeValue 并登记
    const node = div.firstChild as Text;
    node.nodeValue = "译:Plugin Desc (Plugin Desc)";
    p.markWrittenBack(node);
    await wait(300);
    expect((coord as unknown as CoordStub).calls.length).toBe(before); // 双语产物未重送
    expect(div.textContent).toBe("译:Plugin Desc (Plugin Desc)");
  });
});

describe("1.6 A：Notice 通道条件跳过（效率档止损）", () => {
  const patchers: DOMPatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("skipNotice=true：.notice 文本不入译（零 token——用户反馈的 Notice 白耗场景）", async () => {
    const coord = stubCoordinator();
    const calls = (coord as unknown as { calls: string[] }).calls;
    const p = new DOMPatcher(coord, format, () => false, () => {}, undefined, 3000, () => true);
    patchers.push(p);
    p.activate();
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = "New preset: 540/1234";
    document.body.appendChild(notice);
    await wait(300);
    expect(notice.textContent).toBe("New preset: 540/1234"); // 原文保留
    expect(calls).toHaveLength(0); // 未进翻译队列
  });

  it("skipNotice=false（效果优先缺省）：.notice 正常入队翻译", async () => {
    const coord = stubCoordinator();
    const calls = (coord as unknown as { calls: string[] }).calls;
    const p = new DOMPatcher(coord, format, () => false, () => {}, undefined, 3000, () => false);
    patchers.push(p);
    p.activate();
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = "Open Settings";
    document.body.appendChild(notice);
    await wait(300);
    expect(notice.textContent).toBe("译:Open Settings");
    expect(calls).toEqual(["Open Settings"]);
  });
});

describe("1.6 E2 复审补强：throttled 善后（回滚 + 限次重试防永久漏译）", () => {
  const patchers: DOMPatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("throttled 后 processed 已回滚，2s 后自动重试并回写译文（风暴过去队列回落）", async () => {
    let throttling = true;
    const calls: string[] = [];
    const coord = {
      translateWithOutcome: async (t: string) => {
        calls.push(t);
        // 效率档高峰：首轮 throttled；2s 重试时风暴已过 → 正常译文
        return throttling && calls.length === 1
          ? { text: t, outcome: "throttled" as const }
          : { text: `译:${t}`, outcome: "translated" as const };
      },
    } as unknown as TranslationCoordinator;
    const p = new DOMPatcher(coord, format, () => false);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.textContent = "Storm Label";
    document.body.appendChild(div);
    await wait(300);
    expect(div.textContent).toBe("Storm Label"); // 首轮被降级：原文保留
    expect(calls).toEqual(["Storm Label"]);
    throttling = false; // 队列深度回落
    await wait(2600); // 2s 重试窗口
    expect(div.textContent).toBe("译:Storm Label"); // 自动补译回写——无永久漏译
  });

  it("持续 throttled 至 15 次上限后停止重试（不无限循环）", async () => {
    let outcomes = 0;
    const coord = {
      translateWithOutcome: async (t: string) => {
        outcomes++;
        return { text: t, outcome: "throttled" as const };
      },
    } as unknown as TranslationCoordinator;
    const p = new DOMPatcher(coord, format, () => false, () => {}, undefined, 3000);
    patchers.push(p);
    p.activate();
    const div = document.createElement("div");
    div.textContent = "Always Throttled";
    document.body.appendChild(div);
    await wait(300);
    const first = outcomes;
    await wait(3600); // 越过 2~3 个重试窗口
    expect(outcomes).toBeGreaterThan(first); // 重试在进行
    expect(outcomes).toBeLessThanOrEqual(first + 3); // 但受 15 次总上限约束（本窗口仅少量新增）
  });
});

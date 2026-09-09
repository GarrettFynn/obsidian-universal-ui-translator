// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DOMPatcher } from "../../src/interceptors/dom-patcher";
import { TranslationCoordinator } from "../../src/core/coordinator";

interface CoordStub {
  calls: string[];
  translate: (t: string) => Promise<string>;
}

function stubCoordinator(): TranslationCoordinator {
  const calls: string[] = [];
  const stub: CoordStub = {
    calls,
    translate: async (t: string) => {
      calls.push(t);
      return `译:${t}`;
    },
  };
  Object.assign(stub, {});
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

  it("rescanAllText：已渲染未译节点重置记录后重新翻译（v1.1.0 配置热生效）", async () => {
    let broken = true;
    const coord = {
      translate: async (t: string) => (broken ? t : `译:${t}`), // 失败时回退原文（与 coordinator 一致）
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
});

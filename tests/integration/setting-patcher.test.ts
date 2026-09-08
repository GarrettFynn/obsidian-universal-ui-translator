// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Setting } from "obsidian";
import { SettingPatcher } from "../../src/interceptors/setting-patcher";
import { TranslationCoordinator } from "../../src/core/coordinator";

function stubCoordinator(): TranslationCoordinator {
  return { translate: async (t: string) => `译:${t}` } as unknown as TranslationCoordinator;
}
const tick = () => new Promise((r) => setTimeout(r, 10));
const format = (t: string, o: string) => (t === o ? null : t);

describe("SettingPatcher 集成", () => {
  const patchers: SettingPatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("setName/setDesc 翻译完成后回写，且保持链式返回", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const p = new SettingPatcher(stubCoordinator(), format);
    patchers.push(p);
    expect(p.activate()).toBe(true);
    const s = new Setting(container);
    const chained = s.setName("Open Settings").setDesc("Some description here");
    expect(chained).toBe(s); // 链式调用保持
    expect(s.nameEl.textContent).toBe("Open Settings"); // 同步仍原文
    await tick();
    expect(s.nameEl.textContent).toBe("译:Open Settings");
    expect(s.descEl.textContent).toBe("译:Some description here");
  });

  it("setDesc 保留链接子元素：<a> 内文本不译（D-07），纯文本节点翻译（5.3）", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const p = new SettingPatcher(stubCoordinator(), format);
    patchers.push(p);
    p.activate();
    const s = new Setting(container);
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode("See the"));
    const a = document.createElement("a");
    a.textContent = "documentation page";
    frag.appendChild(a);
    frag.appendChild(document.createTextNode("for more details"));
    s.setDesc(frag);
    await tick();
    const link = s.descEl.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe("documentation page"); // 链接文本不译
    expect(s.descEl.textContent).toContain("译:See the");
    expect(s.descEl.textContent).toContain("译:for more details");
  });

  it("自我防护：[data-no-translate] 容器内的设置项不译", async () => {
    const container = document.createElement("div");
    container.setAttribute("data-no-translate", "true");
    document.body.appendChild(container);
    const p = new SettingPatcher(stubCoordinator(), format);
    patchers.push(p);
    p.activate();
    const s = new Setting(container).setName("Open Settings");
    await tick();
    expect(s.nameEl.textContent).toBe("Open Settings");
  });
});

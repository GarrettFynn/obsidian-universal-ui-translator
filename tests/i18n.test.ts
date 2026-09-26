// @vitest-environment jsdom
// i18n 框架测试（1.4 国际化一期批次三）：
// 回退链（locale → zh-CN → key）、{n} 插值、resolveUiLocale 三态、
// en 键集与 zh-CN 键集双向一致、「译」按钮字形 zh/en 两值。
// 批次四追加：en locale 下 settings-tab renderGeneral 渲染产物不含 CJK 字符。
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/i18n/en";
import { zhCN } from "../src/i18n/zh-CN";
import { resolveUiLocale, setUiLocale, t } from "../src/i18n";

// settings-tab 依赖 obsidian 的 PluginSettingTab 与 Setting.add* 组件方法——
// 既有 mock 只实现 setName/setDesc，这里在其上扩展最小渲染面（仅本测试文件生效）
vi.mock("obsidian", async (importOriginal) => {
  const base = await importOriginal<typeof import("./__mocks__/obsidian")>();
  class PluginSettingTab {
    containerEl: HTMLElement;
    constructor(_app: unknown, _plugin: unknown) {
      this.containerEl = document.createElement("div");
    }
    display(): void {}
  }
  class DropdownStub {
    selectEl: HTMLSelectElement = document.createElement("select");
    addOption(value: string, label: string): this {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      this.selectEl.appendChild(opt);
      return this;
    }
    setValue(v: string): this {
      this.selectEl.value = v;
      return this;
    }
    onChange(_cb: (v: string) => unknown): this {
      return this;
    }
  }
  class TextStub {
    inputEl: HTMLInputElement = document.createElement("input");
    setValue(v: string): this {
      this.inputEl.value = v;
      return this;
    }
    setPlaceholder(p: string): this {
      this.inputEl.placeholder = p;
      return this;
    }
    onChange(_cb: (v: string) => unknown): this {
      return this;
    }
  }
  class ToggleStub {
    inputEl: HTMLInputElement;
    constructor() {
      this.inputEl = document.createElement("input");
      this.inputEl.type = "checkbox";
    }
    setValue(v: boolean): this {
      this.inputEl.checked = v;
      return this;
    }
    onChange(_cb: (v: boolean) => unknown): this {
      return this;
    }
  }
  class Setting extends base.Setting {
    addDropdown(cb: (c: DropdownStub) => unknown): this {
      const c = new DropdownStub();
      cb(c);
      this.settingEl.appendChild(c.selectEl);
      return this;
    }
    addText(cb: (c: TextStub) => unknown): this {
      const c = new TextStub();
      cb(c);
      this.settingEl.appendChild(c.inputEl);
      return this;
    }
    addToggle(cb: (c: ToggleStub) => unknown): this {
      const c = new ToggleStub();
      cb(c);
      this.settingEl.appendChild(c.inputEl);
      return this;
    }
  }
  return { ...base, PluginSettingTab, Setting };
});

// jsdom 无 Obsidian 的容器扩展方法：补最小原型（容器空化 + 建元素）
type ElOpts = { cls?: string; text?: string; attr?: Record<string, string> };
const proto = Element.prototype as unknown as Record<string, unknown>;
if (typeof proto.empty !== "function") {
  proto.empty = function (this: HTMLElement) {
    this.replaceChildren();
  };
}
if (typeof proto.createDiv !== "function") {
  proto.createDiv = function (this: HTMLElement, cls?: string) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    this.appendChild(d);
    return d;
  };
}
if (typeof proto.createSpan !== "function") {
  proto.createSpan = function (this: HTMLElement, opts?: ElOpts) {
    const s = document.createElement("span");
    if (opts?.cls) s.className = opts.cls;
    this.appendChild(s);
    return s;
  };
}
if (typeof proto.createEl !== "function") {
  proto.createEl = function (this: HTMLElement, tag: string, opts?: ElOpts) {
    const el = document.createElement(tag);
    if (opts?.cls) el.className = opts.cls;
    if (opts?.text) el.textContent = opts.text;
    for (const [k, v] of Object.entries(opts?.attr ?? {})) el.setAttribute(k, v);
    this.appendChild(el);
    return el;
  };
}

afterEach(() => {
  // locale 为模块级单例状态：用例间复位，避免污染其他测试文件
  setUiLocale("zh-CN");
});

describe("t() 回退链", () => {
  it("当前 locale 命中时返回该 locale 的值", () => {
    setUiLocale("zh-CN");
    expect(t("market.button.glyph")).toBe("译");
    setUiLocale("en");
    expect(t("market.button.glyph")).toBe("TR");
  });

  it("当前 locale 缺键回退 zh-CN 值", () => {
    const saved = en["status.just-now"];
    delete en["status.just-now"];
    try {
      setUiLocale("en");
      expect(t("status.just-now")).toBe(zhCN["status.just-now"]);
    } finally {
      en["status.just-now"] = saved;
    }
  });

  it("双语都缺键返回 key 本身（缺键显形）", () => {
    setUiLocale("en");
    expect(t("no.such.key")).toBe("no.such.key");
    setUiLocale("zh-CN");
    expect(t("no.such.key")).toBe("no.such.key");
  });
});

describe("t() 插值", () => {
  it("{n}/{m} 占位由 vars 替换（状态栏/进度文案）", () => {
    setUiLocale("zh-CN");
    expect(t("status.translating", { n: 3, m: 12 })).toBe("UUT 翻译中… 剩 3（已译 12）");
    expect(t("market.progress.label", { n: 0, m: 2 })).toBe("UUT 翻译中 0/2");
    expect(t("status.circuit-countdown", { n: "04", m: "59" })).toBe("UUT 熔断中 04:59");
  });

  it("同一占位符多次出现全部替换；数字自动转字符串", () => {
    expect(t("status.session-done", { n: 7 })).toBe("UUT ✓ 本会话已译 7 条");
    expect(t("status.import-done", { n: 120 })).toBe("导入完成：120 条缓存条目已合并");
  });

  it("缺 vars 时占位符原样保留（缺参显形）", () => {
    expect(t("status.translating")).toContain("{n}");
    expect(t("status.translating")).toContain("{m}");
  });
});

describe("resolveUiLocale 三态", () => {
  it("显式 zh-CN / en 直取（不受 moment locale 影响）", () => {
    expect(resolveUiLocale("zh-CN", "en")).toBe("zh-CN");
    expect(resolveUiLocale("en", "zh-cn")).toBe("en");
  });

  it("auto 按 Obsidian 界面语言（moment locale）前缀 zh* → zh-CN，否则 en", () => {
    expect(resolveUiLocale("auto", "zh")).toBe("zh-CN");
    expect(resolveUiLocale("auto", "zh-CN")).toBe("zh-CN");
    expect(resolveUiLocale("auto", "zh-TW")).toBe("zh-CN");
    expect(resolveUiLocale("auto", "en")).toBe("en");
    expect(resolveUiLocale("auto", "ja")).toBe("en");
    expect(resolveUiLocale("auto", "")).toBe("en");
  });
});

describe("键集完整性", () => {
  it("en 键集与 zh-CN 键集完全一致（双向断言）", () => {
    const zhKeys = Object.keys(zhCN).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys); // en 无缺失、无多余
    expect(zhKeys).toEqual(enKeys); // 反向再断言一次
  });

  it("全部值为非空字符串", () => {
    for (const [k, v] of Object.entries(zhCN)) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
    for (const [k, v] of Object.entries(en)) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
  });

  it("批次三各域代表键存在（market/status/notice/command/menu/setting/dom/common）", () => {
    const required = [
      "market.button.glyph",
      "market.notify.display-mode",
      "status.translating",
      "status.today-tokens",
      "notice.migrate-v115",
      "command.toggle-original",
      "menu.patcher.activated",
      "setting.patcher.activated",
      "dom.patcher.adopted",
      "common.provider-not-configured",
    ];
    for (const key of required) {
      expect(zhCN[key]).toBeDefined();
      expect(en[key]).toBeDefined();
    }
  });
});

describe("market.button.glyph 字形", () => {
  it("zh 为「译」、en 为 TR（设计 4.2）", () => {
    expect(zhCN["market.button.glyph"]).toBe("译");
    expect(en["market.button.glyph"]).toBe("TR");
  });
});

describe("设置页渲染（批次四）", () => {
  it("en locale 下 renderGeneral 渲染产物不含 CJK 字符（zh 对照出现中文，证明断言有效）", async () => {
    setUiLocale("en");
    const { UutSettingTab } = await import("../src/ui/settings-tab");
    const settings = {
      enabled: true,
      displayMode: "bilingual" as const,
      bilingualFormat: "{t} ({o})",
      targetLang: "zh-CN",
      uiLanguage: "en" as const,
    };
    const plugin = { settings, saveSettings: async () => {} };
    const tab = new UutSettingTab({} as never, plugin as never);
    tab.display();
    const text = tab.containerEl.textContent ?? "";
    expect(text).not.toBe("");
    expect(/[\u4e00-\u9fa5]/.test(text)).toBe(false);
    for (const input of tab.containerEl.querySelectorAll("input[placeholder]")) {
      expect(/[\u4e00-\u9fa5]/.test(input.getAttribute("placeholder") ?? "")).toBe(false);
    }
    // zh 对照：同一渲染路径在 zh-CN 下必须出现中文（否则上面的断言是空转）
    setUiLocale("zh-CN");
    tab.display();
    expect(/[\u4e00-\u9fa5]/.test(tab.containerEl.textContent ?? "")).toBe(true);
  });
});

import { Notice, Setting } from "obsidian";
import { TranslationCoordinator } from "../core/coordinator";

type FormatFn = (translated: string, original: string) => string | null;

/**
 * SettingPatcher（设计文档 4.1.3）
 * - 劫持 Setting.prototype.setName / setDesc / setHeading（保持链式返回 this）
 * - setName / setHeading：翻译字符串参数，完成后回写 nameEl
 * - setDesc：TreeWalker 逐 TextNode 翻译——string 与 DocumentFragment 入参统一处理，
 *   保留 <a> / <kbd> 等子元素与事件绑定（5.3 TextNode 粒度，永不重写 innerHTML）
 * - 回写前存活检查（isConnected，5.2）；自我防护：跳过 [data-no-translate] 容器内的实例
 *   （本插件自己的设置页不被自家通道翻译；核心/社区设置页与 Obsidian 共用 Setting 类，均覆盖）
 * - D1：三个方法特征检测全部通过才激活；deactivate 逐一还原
 * - 归属说明：Setting 实例无法可靠归因来源插件，pluginId 记 "unknown"（D7 全局共享词表）
 */
export class SettingPatcher {
  private restores: Array<() => void> = [];

  constructor(
    private coordinator: TranslationCoordinator,
    private format: FormatFn,
    private debug: (msg: string) => void = () => {}
  ) {}

  activate(): boolean {
    const proto = Setting.prototype as unknown as Record<string, unknown>;
    for (const key of ["setName", "setDesc", "setHeading"]) {
      if (typeof proto[key] !== "function") {
        new Notice("UUT：设置面板通道翻译已停用（Setting 特征检测失败）");
        return false;
      }
    }
    this.wrapNameLike("setName");
    this.wrapNameLike("setHeading");
    this.wrapSetDesc();
    this.debug("SettingPatcher 已激活");
    return true;
  }

  deactivate(): void {
    for (const restore of this.restores) restore();
    this.restores = [];
  }

  /** setName / setHeading：字符串参数翻译后回写 nameEl */
  private wrapNameLike(method: "setName" | "setHeading"): void {
    const proto = Setting.prototype as unknown as Record<string, unknown>;
    const original = proto[method] as (
      this: Setting,
      name: string | DocumentFragment
    ) => Setting;
    const self = this;
    proto[method] = function (this: Setting, name: string | DocumentFragment): Setting {
      const result = original.call(this, name);
      if (typeof name === "string" && name.trim().length >= 2) {
        const el = (this as unknown as { nameEl?: HTMLElement }).nameEl;
        if (el) {
          self.translateText(
            name,
            (formatted) => {
              el.textContent = formatted;
            },
            this
          );
        }
      }
      return result; // 保持链式调用
    };
    this.restores.push(() => {
      proto[method] = original;
    });
  }

  /** setDesc：TreeWalker 逐 TextNode 翻译（5.3 TextNode 粒度） */
  private wrapSetDesc(): void {
    const proto = Setting.prototype as unknown as Record<string, unknown>;
    const original = proto.setDesc as (
      this: Setting,
      desc: string | DocumentFragment
    ) => Setting;
    const self = this;
    proto.setDesc = function (this: Setting, desc: string | DocumentFragment): Setting {
      const result = original.call(this, desc);
      const descEl = (this as unknown as { descEl?: HTMLElement }).descEl;
      if (descEl) {
        const walker = document.createTreeWalker(descEl, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let cur = walker.nextNode();
        while (cur) {
          // 只翻译纯文本节点：跳过 <a>/<kbd>/<code> 内的文本（4.1.3 保留子元素）
          const parentEl = (cur as Text).parentElement;
          if (
            (cur.nodeValue?.trim().length ?? 0) >= 2 &&
            !parentEl?.closest("a, kbd, code")
          ) {
            nodes.push(cur as Text);
          }
          cur = walker.nextNode();
        }
        for (const node of nodes) {
          const fullText = node.nodeValue ?? "";
          const trimmed = fullText.trim();
          self.translateText(
            trimmed,
            (formatted) => {
              node.nodeValue = fullText.replace(trimmed, formatted); // 保留前后空白
            },
            this
          );
        }
      }
      return result;
    };
    this.restores.push(() => {
      proto.setDesc = original;
    });
  }

  /** 翻译并在存活/自我防护检查后回写（5.2 / [data-no-translate]） */
  private translateText(
    text: string,
    writeBack: (formatted: string) => void,
    setting: Setting
  ): void {
    this.coordinator
      .translate(text, { source: "setting", pluginId: "unknown" })
      .then((t) => {
        const formatted = this.format(t, text);
        if (formatted === null) return;
        const settingEl = (setting as unknown as { settingEl?: HTMLElement }).settingEl;
        if (settingEl && !settingEl.isConnected) return; // 存活检查：设置页可能已切换
        if (settingEl?.closest("[data-no-translate]")) return; // 自我防护
        writeBack(formatted);
      })
      .catch(() => undefined);
  }
}

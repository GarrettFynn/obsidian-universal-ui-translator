import { Menu, MenuItem, Notice } from "obsidian";
import { TranslationCoordinator } from "../core/coordinator";

type FormatFn = (translated: string, original: string) => string | null;

/**
 * MenuPatcher（设计文档 4.1.2）
 * - 劫持 Menu.prototype.addItem，包装回调中对 item.setTitle 的调用
 * - setTitle 接受 string | DocumentFragment：仅处理 string 分支
 * - 先以原文显示（避免阻塞菜单弹出），翻译完成后经原 setTitle 原地替换
 * - 双语模式：菜单空间受限，仅显译文，原文进 tooltip（5.1）
 * - D1：激活前特征检测，失败仅停用本通道；deactivate 还原原型
 * - 归属说明：菜单注册点无法可靠归因来源插件，pluginId 记 "unknown"（D7 全局共享词表）
 */
export class MenuPatcher {
  private originalAddItem: Menu["addItem"] | null = null;

  constructor(
    private coordinator: TranslationCoordinator,
    private format: FormatFn,
    private isBilingual: () => boolean,
    private debug: (msg: string) => void = () => {}
  ) {}

  activate(): boolean {
    const proto = Menu.prototype as unknown as Record<string, unknown>;
    if (typeof proto.addItem !== "function") {
      new Notice("UUT：菜单通道翻译已停用（addItem 特征检测失败）");
      return false;
    }
    this.originalAddItem = Menu.prototype.addItem;
    const self = this;
    (Menu.prototype as unknown as Record<string, unknown>).addItem = function (
      this: Menu,
      cb: (item: MenuItem) => void
    ): Menu {
      return self.originalAddItem!.call(this, (item: MenuItem) => {
        self.wrapSetTitle(item);
        return cb(item);
      });
    };
    this.debug("MenuPatcher 已激活");
    return true;
  }

  deactivate(): void {
    if (this.originalAddItem) {
      (Menu.prototype as unknown as Record<string, unknown>).addItem =
        this.originalAddItem;
      this.originalAddItem = null;
    }
  }

  private wrapSetTitle(item: MenuItem): void {
    const originalSetTitle = item.setTitle.bind(item);
    const self = this;
    item.setTitle = function (title: string | DocumentFragment): MenuItem {
      if (typeof title !== "string" || !title) {
        return originalSetTitle(title);
      }
      const result = originalSetTitle(title); // 先显原文，不阻塞菜单弹出
      self.coordinator
        .translate(title, { source: "menu", pluginId: "unknown" })
        .then((t) => {
          const formatted = self.format(t, title);
          if (formatted === null) return;
          originalSetTitle(formatted);
          // 双语模式：仅显译文，原文进 tooltip（5.1 空间受限区域策略）
          // titleEl 为 Obsidian 运行时内部属性（公开类型未声明），按项目惯例断言访问
          const titleEl = (item as unknown as { titleEl?: HTMLElement }).titleEl;
          if (self.isBilingual() && titleEl) {
            titleEl.setAttr("title", title);
          }
        })
        .catch(() => undefined);
      return result;
    };
  }
}

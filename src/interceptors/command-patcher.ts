import { App, Command, Notice, Plugin } from "obsidian";
import { TranslationCoordinator } from "../core/coordinator";

/**
 * CommandPatcher（设计文档 4.1.1，方案经 Spike S1/S2 实测验证）
 * - 双路径：存量遍历 app.commands.listCommands() + 增量劫持 Plugin.prototype.addCommand
 * - getter/setter 配对懒翻译；command.id 永不变更，快捷键与搜索索引不受影响
 * - D1：激活前特征检测，失败熔断（仅停用本通道）；单条 patch 失败不影响其他
 * - deactivate 完整还原：原型方法 + 每个命令实例上的原始属性（设计文档测试用例 5/9）
 */
export class CommandPatcher {
  private originalAddCommand: typeof Plugin.prototype.addCommand | null = null;
  private patched = new Map<object, Record<string, string>>();
  /** R-07：各键运行时译文的重置回调（getter 闭包不可从外部到达，须逐键登记） */
  private resetters: (() => void)[] = [];

  constructor(
    private app: App,
    private coordinator: TranslationCoordinator,
    private isPluginExcluded: (pluginId: string) => boolean,
    private debug: (msg: string) => void = () => {},
    /** R-13：回写格式化（bilingual 时返回「译文 (原文)」）；缺省为纯译文（向后兼容） */
    private format: (translated: string, original: string) => string | null = (t) => t
  ) {}

  /** @returns true 激活成功；false 特征检测失败，本通道熔断（D1），其余通道不受影响 */
  activate(): boolean {
    const proto = Plugin.prototype as unknown as Record<string, unknown>;
    if (typeof proto.addCommand !== "function") {
      new Notice("UUT：命令通道翻译已停用（addCommand 特征检测失败）");
      return false;
    }
    // 路径 1：存量命令——核心命令 + 先于本插件加载的插件命令
    const commandsApi = (
      this.app as unknown as { commands?: { listCommands?: () => Command[] } }
    ).commands;
    if (commandsApi && typeof commandsApi.listCommands === "function") {
      for (const command of commandsApi.listCommands()) {
        this.patchCommand(command, this.resolvePluginId(command));
      }
    } else {
      // S2 已实测可用；若未来 Obsidian 变更此内部 API，存量命令由 DOMPatcher 兜底（D1）
      this.debug("app.commands.listCommands 不可用，存量命令留待 DOMPatcher 兜底");
    }
    // 路径 2：增量劫持——本插件加载后才注册的命令
    this.originalAddCommand = Plugin.prototype.addCommand;
    const self = this;
    (Plugin.prototype as unknown as Record<string, unknown>).addCommand = function (
      this: Plugin,
      command: Command
    ) {
      self.patchCommand(command, this.manifest?.id ?? "unknown");
      return self.originalAddCommand!.call(this, command);
    };
    this.debug(`CommandPatcher 已激活，存量 patch ${this.patched.size} 条`);
    return true;
  }

  deactivate(): void {
    if (this.originalAddCommand) {
      (Plugin.prototype as unknown as Record<string, unknown>).addCommand =
        this.originalAddCommand;
      this.originalAddCommand = null;
    }
    // 实例级还原：逐一恢复原始字符串属性（只还原原型不能清理实例上的 getter）
    for (const [command, originals] of this.patched) {
      for (const [key, value] of Object.entries(originals)) {
        Object.defineProperty(command, key, { value, writable: true, configurable: true });
      }
    }
    this.patched.clear();
    this.resetters = [];
  }

  /** R-07：清空全部 getter 闭包内的运行时译文，下次访问重新走翻译流程（随「清空缓存」联动） */
  resetRuntimeTranslations(): void {
    for (const reset of this.resetters) reset();
  }

  /**
   * 存量路径归属推断（S2 附属发现后的修正版，设计文档 4.1.1）：
   * 取命令 id 首个冒号前的前缀，与已启用插件 id 注册表比对；命中记为该插件，否则记为 core。
   */
  private resolvePluginId(command: Command): string {
    const id = String((command as unknown as { id?: unknown }).id ?? "");
    const prefix = id.split(":")[0];
    const manifests = (
      this.app as unknown as { plugins?: { manifests?: Record<string, { id: string }> } }
    ).plugins?.manifests;
    if (prefix && manifests && manifests[prefix]) return prefix;
    return "core";
  }

  private patchCommand(command: Command, pluginId: string): void {
    if (this.patched.has(command)) return;
    if (this.isPluginExcluded(pluginId)) return;
    try {
      const originals: Record<string, string> = {};
      for (const key of ["name", "description"] as const) {
        const value = (command as unknown as Record<string, unknown>)[key];
        if (typeof value !== "string" || !value) continue;
        originals[key] = value;
        let original = value;
        let translated: string | null = null;
        let requested = false;
        Object.defineProperty(command, key, {
          get: () => {
            if (!requested) {
              requested = true;
              this.coordinator
                .translate(original, { source: "command", pluginId })
                .then((t) => {
                  translated = t;
                })
                .catch(() => undefined); // coordinator 设计上不抛异常，此为双保险
            }
            // R-13：经显示模式格式化——bilingual 返回「译文 (原文)」；original/同文回原文
            if (translated === null) return original;
            return this.format(translated, original) ?? original;
          },
          set: (v: string) => {
            // 外部重新赋值：更新原文并重新排队翻译（getter/setter 必须配对，4.1.1）
            original = v;
            translated = null;
            requested = false;
            originals[key] = v;
          },
          configurable: true,
        });
        // R-07：登记该键的运行时译文重置回调（闭包内 translated/requested 仅此处可达）
        this.resetters.push(() => {
          translated = null;
          requested = false;
        });
      }
      if (Object.keys(originals).length > 0) {
        this.patched.set(command, originals);
      }
    } catch (e) {
      // 优雅降级：单条命令 patch 失败仅跳过该条
      this.debug(`patch 命令失败（已跳过）: ${String(e)}`);
    }
  }
}

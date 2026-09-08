// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Command, Plugin } from "obsidian";
import { CommandPatcher } from "../../src/interceptors/command-patcher";
import { TranslationCoordinator } from "../../src/core/coordinator";

function fakeApp(commands: Command[]) {
  return { commands: { listCommands: () => commands } };
}

function stubCoordinator(): TranslationCoordinator {
  return { translate: async (t: string) => `译:${t}` } as unknown as TranslationCoordinator;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("CommandPatcher 集成（8.1：劫持→翻译→回写→还原全链路）", () => {
  const patchers: CommandPatcher[] = [];
  afterEach(() => {
    // Patcher 会污染全局原型，每个用例后必须还原
    for (const p of patchers.splice(0)) p.deactivate();
  });

  it("存量命令 getter 懒翻译：首次读原文，翻译完成后读译文", async () => {
    const commands: Command[] = [{ id: "app:open-settings", name: "Open Settings" }];
    const p = new CommandPatcher(fakeApp(commands) as never, stubCoordinator(), () => false);
    patchers.push(p);
    expect(p.activate()).toBe(true);
    expect(commands[0].name).toBe("Open Settings"); // 首次访问返回原文（翻译在途）
    void commands[0].name === "Open Settings"; // 已触发过翻译（上面的读取）
    await tick();
    expect(commands[0].name).toBe("译:Open Settings");
  });

  it("增量劫持：激活后其他插件注册的新命令同样被 patch", async () => {
    const p = new CommandPatcher(fakeApp([]) as never, stubCoordinator(), () => false);
    patchers.push(p);
    p.activate();
    // Plugin 在公开类型中为 abstract（tsc 口径）；运行时经 vitest alias 走 mock，可实例化
    const other = new (Plugin as unknown as new () => Plugin)();
    // manifest 字面量同样按真实 PluginManifest 断言（mock 仅需 id 字段）
    other.manifest = { id: "other-plugin" } as Plugin["manifest"];
    const cmd: Command = { id: "other-plugin:do", name: "Do Thing" };
    other.addCommand(cmd);
    void cmd.name; // 触发懒翻译
    await tick();
    expect(cmd.name).toBe("译:Do Thing");
  });

  it("deactivate 完整还原：原型与实例级（8.2 用例 5/9 自动化版）", async () => {
    const original = Plugin.prototype.addCommand;
    const commands: Command[] = [{ id: "app:x", name: "Open Settings" }];
    const p = new CommandPatcher(fakeApp(commands) as never, stubCoordinator(), () => false);
    patchers.push(p);
    p.activate();
    expect(Plugin.prototype.addCommand).not.toBe(original);
    void commands[0].name;
    await tick();
    p.deactivate();
    expect(Plugin.prototype.addCommand).toBe(original);
    const d = Object.getOwnPropertyDescriptor(commands[0], "name");
    expect(d?.value).toBe("Open Settings"); // 恢复原始字符串属性
    expect(d?.get).toBeUndefined(); // getter 无残留
  });

  it("黑名单插件的命令不被 patch", () => {
    const commands: Command[] = [{ id: "app:x", name: "Open Settings" }];
    const p = new CommandPatcher(fakeApp(commands) as never, stubCoordinator(), () => true);
    patchers.push(p);
    p.activate();
    const d = Object.getOwnPropertyDescriptor(commands[0], "name");
    expect(d?.get).toBeUndefined();
  });

  it("R-13：双语格式下 getter 返回「译文 (原文)」括注", async () => {
    const commands: Command[] = [{ id: "app:x", name: "Open Settings" }];
    const p = new CommandPatcher(
      fakeApp(commands) as never,
      stubCoordinator(),
      () => false,
      () => {},
      (t, o) => `${t} (${o})`
    );
    patchers.push(p);
    p.activate();
    void commands[0].name; // 触发懒翻译
    await tick();
    expect(commands[0].name).toBe("译:Open Settings (Open Settings)");
  });

  it("存量扫描延迟到布局就绪后（启动期 checkCallback 抛错防护，1.13.7 实测复现）", async () => {
    let ready: (() => void) | null = null;
    const app = {
      commands: { listCommands: () => commands },
      workspace: { onLayoutReady: (cb: () => void) => { ready = cb; } },
    };
    const commands: Command[] = [{ id: "app:open-settings", name: "Open Settings" }];
    const p = new CommandPatcher(app as never, stubCoordinator(), () => false);
    patchers.push(p);
    expect(p.activate()).toBe(true);
    // 布局未就绪：存量命令尚未 patch（无 getter，不会被半截状态的 listCommands 漏掉）
    expect(Object.getOwnPropertyDescriptor(commands[0], "name")?.get).toBeUndefined();
    ready!();
    expect(Object.getOwnPropertyDescriptor(commands[0], "name")?.get).toBeTypeOf("function");
    void commands[0].name;
    await tick();
    expect(commands[0].name).toBe("译:Open Settings");
  });
});

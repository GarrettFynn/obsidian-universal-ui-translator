/** Obsidian 运行时模块的测试替身（8.1 集成测试；仅实现被测通道用到的最小面） */

// jsdom 无 Obsidian 的 HTMLElement.setAttr 扩展：最小 polyfill（MenuPatcher 双语 tooltip 等使用）
if (typeof HTMLElement !== "undefined" && !("setAttr" in HTMLElement.prototype)) {
  (
    HTMLElement.prototype as unknown as { setAttr: (name: string, value: string) => void }
  ).setAttr = function (name: string, value: string) {
    this.setAttribute(name, value);
  };
}

export class Notice {
  constructor(public message?: unknown) {}
}

export interface Command {
  id: string;
  name: string;
  description?: string;
  callback?: () => void;
}

export class Plugin {
  manifest: { id: string } = { id: "mock-plugin" };
  addCommand(_command: Command): void {
    /* 注册行为不在本 mock 职责内 */
  }
}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.settingEl.append(this.nameEl, this.descEl);
    containerEl.appendChild(this.settingEl);
  }
  setName(name: string | DocumentFragment): this {
    if (typeof name === "string") this.nameEl.textContent = name;
    return this;
  }
  setDesc(desc: string | DocumentFragment): this {
    if (typeof desc === "string") this.descEl.textContent = desc;
    else this.descEl.appendChild(desc);
    return this;
  }
  setHeading(name: string | DocumentFragment): this {
    return this.setName(name);
  }
}

export class MenuItem {
  titleEl: HTMLElement = document.createElement("div");
  setTitle(title: string | DocumentFragment): this {
    if (typeof title === "string") this.titleEl.textContent = title;
    return this;
  }
}

export class Menu {
  items: MenuItem[] = [];
  addItem(cb: (item: MenuItem) => void): this {
    const item = new MenuItem();
    this.items.push(item);
    cb(item);
    return this;
  }
}

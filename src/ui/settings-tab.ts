import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type UniversalUiTranslatorPlugin from "../../main";

type TabId = "general" | "api" | "scope" | "cache" | "advanced";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "general", label: "基础" },
  { id: "api", label: "API 配置" },
  { id: "scope", label: "作用域" },
  { id: "cache", label: "缓存" },
  { id: "advanced", label: "高级" },
];

const PROVIDERS: Array<{ id: string; label: string }> = [
  { id: "openai", label: "OpenAI 兼容接口" },
  { id: "deepl", label: "DeepL" },
  { id: "google", label: "Google Cloud Translation" },
  { id: "azure", label: "Azure Translator" },
  { id: "custom", label: "自定义端点（本地模型）" },
];

/**
 * 五分页设置面板（设计文档 4.5 完整版）
 * 自建 tab 组件（Obsidian 无原生分页控件，按钮组 + 容器切换）
 * 白/黑名单 MVP 采用多行文本框（每行一个插件 id）+ 已安装插件 id 参考清单；
 * 「带搜索的多选列表」属后续打磨项（已声明的迭代偏差）
 */
export class UutSettingTab extends PluginSettingTab {
  private activeTab: TabId = "general";

  constructor(app: App, private plugin: UniversalUiTranslatorPlugin) {
    super(app, plugin);
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    // 自我防护：本插件设置页不被自家拦截通道翻译（白名单 [data-no-translate]）
    containerEl.setAttr("data-no-translate", "true");

    const tabBar = containerEl.createDiv("uut-tabbar");
    for (const tab of TABS) {
      const btn = tabBar.createEl("button", {
        cls: `uut-tab${tab.id === this.activeTab ? " uut-tab-active" : ""}`,
        text: tab.label,
      });
      btn.addEventListener("click", () => {
        this.activeTab = tab.id;
        void this.display();
      });
    }

    const content = containerEl.createDiv("uut-tab-content");
    if (this.activeTab === "general") this.renderGeneral(content);
    else if (this.activeTab === "api") await this.renderApi(content);
    else if (this.activeTab === "scope") this.renderScope(content);
    else if (this.activeTab === "cache") this.renderCache(content);
    else this.renderAdvanced(content);
  }

  /** 基础：总开关、显示模式、双语格式、目标语言（4.5） */
  private renderGeneral(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el)
      .setName("启用界面翻译")
      .setDesc("总开关；未配置可用翻译引擎时拦截器不激活（设计文档 4.4.2）")
      .addToggle((t) =>
        t.setValue(s.enabled).onChange(async (v) => {
          s.enabled = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("显示模式")
      .addDropdown((d) =>
        d
          .addOption("replace", "纯译文")
          .addOption("bilingual", "双语对照")
          .addOption("original", "原文（暂停回写）")
          .setValue(s.displayMode)
          .onChange(async (v) => {
            s.displayMode = v as typeof s.displayMode;
            await this.plugin.saveSettings();
          })
      );
    new Setting(el)
      .setName("双语格式")
      .setDesc("仅双语对照模式生效")
      .addDropdown((d) =>
        d
          .addOption("{t} ({o})", "译文 (原文)")
          .addOption("{o} | {t}", "原文 | 译文")
          .setValue(s.bilingualFormat)
          .onChange(async (v) => {
            s.bilingualFormat = v as typeof s.bilingualFormat;
            await this.plugin.saveSettings();
          })
      );
    new Setting(el)
      .setName("目标语言")
      .setDesc("如 zh-CN / zh-Hant / ja 等（缓存键含语言维度，切换互不影响）")
      .addText((text) =>
        text.setValue(s.targetLang).setPlaceholder("zh-CN").onChange(async (v) => {
          s.targetLang = v.trim() || "zh-CN";
          await this.plugin.saveSettings();
        })
      );
  }

  /** API 配置：引擎选择与参数、Key、连通性测试、用量与预算（4.5） */
  private async renderApi(el: HTMLElement): Promise<void> {
    const s = this.plugin.settings;
    new Setting(el).setName("翻译引擎").addDropdown((d) => {
      for (const p of PROVIDERS) d.addOption(p.id, p.label);
      d.setValue(s.activeProvider).onChange(async (v) => {
        s.activeProvider = v;
        await this.plugin.saveSettings();
        await this.display();
      });
    });

    const cfg = s.providers[s.activeProvider] ?? {};
    s.providers[s.activeProvider] = cfg;

    const keySaved = await this.plugin.hasApiKey(s.activeProvider);
    new Setting(el)
      .setName("API Key")
      .setDesc(
        (this.plugin.isKeyEncryptionAvailable()
          ? "safeStorage 加密存储于 secrets.bin，不写入 data.json（4.4.1）"
          : "当前系统不支持系统级加密，Key 仅以混淆方式存储于 secrets.bin，请勿同步该文件（4.4.1 降级分支）") +
          `｜Key 状态：${keySaved ? "已保存" : "未保存"}`
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(keySaved ? "已保存，输入新 Key 可覆盖" : "输入后自动加密保存")
          .onChange(async (v) => {
            await this.plugin.saveApiKey(s.activeProvider, v.trim());
            await this.display();
          });
      });

    if (s.activeProvider === "openai") {
      this.addTextSetting(el, "Base URL", "可指向本地模型，如 http://localhost:11434/v1",
        cfg.apiBaseUrl ?? "", "https://api.openai.com/v1",
        async (v) => { cfg.apiBaseUrl = v; });
      this.addTextSetting(el, "模型", "默认 gpt-4o-mini（低成本档）",
        cfg.model ?? "", "gpt-4o-mini",
        async (v) => { cfg.model = v; });
      new Setting(el)
        .setName("关闭思考模式")
        .setDesc("DeepSeek V4 等默认开启“思考”的模型建议打开：UI 短文本无需推理，关掉后更快、更省 tokens")
        .addToggle((t) =>
          t.setValue(cfg.disableThinking ?? false).onChange(async (v) => {
            cfg.disableThinking = v;
            await this.plugin.saveSettings();
          })
        );
    } else if (s.activeProvider === "azure") {
      this.addTextSetting(el, "Region", "如 eastasia", cfg.region ?? "", "eastasia",
        async (v) => { cfg.region = v; });
    } else if (s.activeProvider === "custom") {
      this.addTextSetting(el, "端点 URL", "如 http://localhost:11434/v1/chat/completions",
        cfg.apiBaseUrl ?? "", "http://localhost:11434/v1/chat/completions",
        async (v) => { cfg.apiBaseUrl = v; });
      this.addTextSetting(el, "模型名", "", cfg.model ?? "", "",
        async (v) => { cfg.model = v; });
      new Setting(el)
        .setName("请求体模板")
        .setDesc("占位符 {{text}} {{targetLang}} {{model}}；留空使用 OpenAI 兼容模板")
        .addTextArea((text) =>
          text.setValue(cfg.requestTemplate ?? "").onChange(async (v) => {
            cfg.requestTemplate = v;
            await this.plugin.saveSettings();
          })
        );
      this.addTextSetting(el, "响应路径", "点分隔路径，如 choices.0.message.content；留空为默认值",
        cfg.responsePath ?? "", "",
        async (v) => { cfg.responsePath = v; });
    }

    new Setting(el)
      .setName("连通性测试")
      .setDesc("向当前引擎发送一次测试请求")
      .addButton((b) =>
        b.setButtonText("测试连接").onClick(async () => {
          b.setDisabled(true);
          try {
            const res = await this.plugin.testActiveProvider();
            new Notice(`UUT：${res.message}`);
          } finally {
            b.setDisabled(false);
          }
        })
      );

    const usage = await this.plugin.monthlyUsage();
    new Setting(el)
      .setName("用量统计")
      .setDesc(`本月已发送 ${usage} 字符（会话内内存统计；usage.json 持久化）`);
    new Setting(el)
      .setName("月度字符预算")
      .setDesc("超限自动暂停送译并回退原文（4.5 熔断）；留空为不限")
      .addText((text) => {
        text.inputEl.type = "number";
        text
          .setValue(s.monthlyCharBudget === null ? "" : String(s.monthlyCharBudget))
          .setPlaceholder("不限")
          .onChange(async (v) => {
            const n = Number(v);
            s.monthlyCharBudget = v.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, Math.floor(n));
            await this.plugin.saveSettings();
          });
      });
  }

  /** 作用域：核心/社区开关、拦截器独立开关、白/黑名单（4.5 / FR-11） */
  private renderScope(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el)
      .setName("翻译 Obsidian 核心界面")
      .addToggle((t) =>
        t.setValue(s.scope.core).onChange(async (v) => {
          s.scope.core = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("翻译社区插件界面")
      .addToggle((t) =>
        t.setValue(s.scope.communityPlugins).onChange(async (v) => {
          s.scope.communityPlugins = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el).setName("拦截器独立开关").setDesc("单通道异常时关闭对应通道（D1 熔断手动入口）");
    const interceptors: Array<{ key: keyof typeof s.interceptors; label: string }> = [
      { key: "command", label: "命令面板" },
      { key: "menu", label: "菜单" },
      { key: "setting", label: "设置面板" },
      { key: "dom", label: "DOM 兜底" },
    ];
    for (const item of interceptors) {
      new Setting(el).setName(item.label).addToggle((t) =>
        t.setValue(s.interceptors[item.key]).onChange(async (v) => {
          s.interceptors[item.key] = v;
          await this.plugin.saveSettings();
        })
      );
    }

    this.addIdListSetting(el, "插件白名单", "非空时仅翻译这些插件（每行一个插件 id）",
      s.scope.pluginWhitelist);
    this.addIdListSetting(el, "插件黑名单", "这些插件的界面不翻译（默认含本插件自身）",
      s.scope.pluginBlacklist);

    const manifests = (
      this.app as unknown as { plugins?: { manifests?: Record<string, { id: string }> } }
    ).plugins?.manifests;
    if (manifests) {
      const ids = Object.keys(manifests).sort().join("、");
      new Setting(el).setName("已安装插件 id 参考").setDesc(ids);
    }
  }

  /** 缓存：统计、清空、导出/导入（4.5 / FR-12） */
  private renderCache(el: HTMLElement): void {
    const stats = this.plugin.cache.stats();
    new Setting(el)
      .setName("缓存统计")
      .setDesc(
        `条目 ${stats.size}，命中率 ${(stats.hitRate * 100).toFixed(1)}%（会话内内存统计）｜文件 translation-cache.json`
      );
    new Setting(el)
      .setName("清空缓存")
      .setDesc("同时重置界面已显示的译文（R-07 联动）")
      .addButton((b) =>
        b.setButtonText("清空缓存").setWarning().onClick(async () => {
          this.plugin.cache.clear();
          this.plugin.resetCommandTranslations();
          await this.plugin.cache.flush();
          new Notice("UUT：缓存已清空，界面译文将在下次访问时重新翻译");
          await this.display();
        })
      );
    new Setting(el)
      .setName("导出缓存")
      .setDesc("导出到库根目录 universal-ui-translator-cache-export.json，可共享给其他用户")
      .addButton((b) =>
        b.setButtonText("导出").onClick(async () => {
          const res = await this.plugin.exportCache();
          new Notice(`UUT：${res.message}`);
        })
      );
    const fileInput = el.createEl("input", {
      attr: { type: "file", accept: ".json,application/json" },
    });
    new Setting(el)
      .setName("导入缓存")
      .setDesc("选择缓存 JSON 文件（校验 schemaVersion 与条目结构，非法文件拒绝）")
      .addButton((b) =>
        b.setButtonText("导入").onClick(async () => {
          const file = fileInput.files?.[0];
          if (!file) {
            new Notice("UUT：请先选择缓存 JSON 文件");
            return;
          }
          const res = await this.plugin.importCache(await file.text());
          new Notice(`UUT：${res.message}`);
          await this.display();
        })
      );
  }

  /** 高级：过滤正则、术语表、批量参数、调试模式（4.5） */
  private renderAdvanced(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el)
      .setName("跳过规则（正则）")
      .setDesc("每行一条正则；命中文本不送译（4.2.1 规则 1）")
      .addTextArea((text) =>
        text.setValue(s.skipPatterns.join("\n")).onChange(async (v) => {
          s.skipPatterns = v.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("术语表（固定译法）")
      .setDesc("每行一条：原文=译文；命中直接返回，不进缓存与 API（FR-15）")
      .addTextArea((text) =>
        text
          .setValue(
            Object.entries(s.glossary).map(([k, v]) => `${k}=${v}`).join("\n")
          )
          .onChange(async (v) => {
            const g: Record<string, string> = {};
            for (const line of v.split("\n")) {
              const idx = line.indexOf("=");
              if (idx > 0) {
                g[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
              }
            }
            s.glossary = g;
            await this.plugin.saveSettings();
          })
      );
    new Setting(el)
      .setName("批量聚合窗口（毫秒）")
      .setDesc("默认 100，可配置 50–500（4.2.2）")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(s.batchWindowMs)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 50 && n <= 500) {
            s.batchWindowMs = Math.floor(n);
            await this.plugin.saveSettings();
          }
        });
      });
    new Setting(el)
      .setName("最大并发请求数")
      .setDesc("默认 3，避免触发 API 限流（4.2.2）")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(s.maxConcurrentRequests)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1 && n <= 10) {
            s.maxConcurrentRequests = Math.floor(n);
            await this.plugin.saveSettings();
          }
        });
      });
    new Setting(el)
      .setName("单请求超时（毫秒）")
      .setDesc("默认 30000（R-23：慢引擎上调）；可配置 5000–120000（4.2.2）")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(s.requestTimeoutMs)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 5000 && n <= 120000) {
            s.requestTimeoutMs = Math.floor(n);
            await this.plugin.saveSettings();
          }
        });
      });
    new Setting(el)
      .setName("调试模式")
      .setDesc("Console 输出拦截日志")
      .addToggle((t) =>
        t.setValue(s.debugMode).onChange(async (v) => {
          s.debugMode = v;
          await this.plugin.saveSettings();
        })
      );
  }

  private addTextSetting(
    el: HTMLElement,
    name: string,
    desc: string,
    value: string,
    placeholder: string,
    apply: (v: string) => Promise<void>
  ): void {
    new Setting(el).setName(name).setDesc(desc).addText((text) =>
      text.setValue(value).setPlaceholder(placeholder).onChange(async (v) => {
        await apply(v.trim());
        await this.plugin.saveSettings();
      })
    );
  }

  private addIdListSetting(
    el: HTMLElement,
    name: string,
    desc: string,
    list: string[]
  ): void {
    new Setting(el).setName(name).setDesc(desc).addTextArea((text) =>
      text.setValue(list.join("\n")).onChange(async (v) => {
        const next = v.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
        list.length = 0;
        list.push(...next);
        await this.plugin.saveSettings();
      })
    );
  }
}

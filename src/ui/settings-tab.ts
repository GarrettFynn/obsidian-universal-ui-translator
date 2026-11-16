import {
  App,
  DropdownComponent,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
} from "obsidian";
import type UniversalUiTranslatorPlugin from "../../main";
import { estimateTokenCost, fmtCompact, fmtCost } from "../core/format";
import { t } from "../i18n";

type TabId = "general" | "api" | "usage" | "scope" | "cache" | "advanced";

/**
 * 1.4 批次四：文案键化——数组只保留 id 与键名，label 渲染时经 t() 解析。
 * 禁止在模块加载期求值 t()（模块加载早于 uiLanguage 读取，加载期解析会冻结 locale）。
 */
const TABS: Array<{ id: TabId; key: string }> = [
  { id: "general", key: "settings.tab.general" },
  { id: "api", key: "settings.tab.api" },
  { id: "usage", key: "settings.tab.usage" },
  { id: "scope", key: "settings.tab.scope" },
  { id: "cache", key: "settings.tab.cache" },
  { id: "advanced", key: "settings.tab.advanced" },
];

const PROVIDERS: Array<{ id: string; key: string }> = [
  { id: "openai", key: "settings.provider.openai" },
  { id: "deepl", key: "settings.provider.deepl" },
  { id: "google", key: "settings.provider.google" },
  { id: "azure", key: "settings.provider.azure" },
  { id: "custom", key: "settings.provider.custom" },
];

/**
 * 1.4 批次五（设计五节）：目标语言常用快速下拉——12 项。
 * 选项标签用语言代码本身：不新撰文案（红线：批次五唯一新撰中文文案为 notice.lang.switched），
 * 且保证 en locale 下 renderGeneral 渲染产物零 CJK（tests/i18n.test.ts 既有断言）。
 */
const QUICK_LANGS = [
  "zh-CN",
  "zh-Hant",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "ar",
  "hi",
] as const;

/**
 * 费用估算基准（v1.1.7 换价；单一事实来源，各 Tab 共用）：
 * DeepSeek flash 系列 2026-09-10 12:00（北京时间）起，每百万 tokens：
 * 空闲时段 输入缓存命中 ¥0.02 / 未命中 ¥1 / 输出 ¥4；高峰时段为空闲 2 倍（¥0.04 / ¥2 / ¥8）。
 * 折算：输入 tokens ≈ 字符数 / 4（英文原文）；输出 tokens ≈ 字符数 / 2.5
 * （中文译文 1 token ≈ 1.5 汉字，长度约为原文 60%）。仅为量级参考，不代表账单口径。
 * 1.4 批次四：原模块级 COST_BASIS 常量改为函数——调用时刻 t() 解析，避免模块加载期冻结 locale。
 */
function costBasis(): string {
  return t("settings.cost-basis");
}

/** 按基准价把已发送字符数折算为 tokens 分解 + 人民币费用（高峰价，空闲减半） */
function estimateCost(chars: number): string {
  if (chars <= 0) return t("settings.usage.cost-zero");
  const inTok = Math.ceil(chars / 4);
  const outTok = Math.ceil(chars / 2.5);
  const yuan = inTok * 2e-6 + outTok * 8e-6; // 高峰时段价
  const tokText = t("settings.usage.cost-tokens", {
    total: (inTok + outTok).toLocaleString(),
    in: inTok.toLocaleString(),
    out: outTok.toLocaleString(),
  });
  if (yuan < 0.01) return t("settings.usage.cost-low", { tokens: tokText });
  return t("settings.usage.cost-high", { tokens: tokText, yuan: yuan.toFixed(2) });
}

/**
 * 五分页设置面板（设计文档 4.5 完整版）
 * 自建 tab 组件（Obsidian 无原生分页控件，按钮组 + 容器切换）
 * 白/黑名单 MVP 采用多行文本框（每行一个插件 id）+ 已安装插件 id 参考清单；
 * 「带搜索的多选列表」属后续打磨项（已声明的迭代偏差）
 */
export class UutSettingTab extends PluginSettingTab {
  private activeTab: TabId = "general";
  /** v1.3：用量页图表口径（token 实测 ⇄ 字符折算估算；实例字段不持久化，关页即回默认） */
  private usageChartBasis: "token" | "chars" = "token";

  constructor(app: App, private plugin: UniversalUiTranslatorPlugin) {
    super(app, plugin);
  }

  display(): void {
    void this.renderTabs();
  }

  /** 实际渲染（原 display 方法体）：基类 display() 为 void，异步渲染经 void 发起不阻塞 */
  private async renderTabs(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    // 自我防护：本插件设置页不被自家拦截通道翻译（白名单 [data-no-translate]）
    containerEl.setAttr("data-no-translate", "true");

    const tabBar = containerEl.createDiv("uut-tabbar");
    for (const tab of TABS) {
      const btn = tabBar.createEl("button", {
        cls: `uut-tab${tab.id === this.activeTab ? " uut-tab-active" : ""}`,
        text: t(tab.key),
      });
      btn.addEventListener("click", () => {
        this.activeTab = tab.id;
        void this.renderTabs();
      });
    }

    const content = containerEl.createDiv("uut-tab-content");
    if (this.activeTab === "general") this.renderGeneral(content);
    else if (this.activeTab === "api") await this.renderApi(content);
    else if (this.activeTab === "usage") await this.renderUsage(content);
    else if (this.activeTab === "scope") this.renderScope(content);
    else if (this.activeTab === "cache") await this.renderCache(content);
    else this.renderAdvanced(content);
  }

  /** 基础：总开关、显示模式、双语格式、目标语言（4.5） */
  private renderGeneral(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el)
      .setName(t("settings.general.enable"))
      .setDesc(t("settings.general.enable.desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.enabled).onChange(async (v) => {
          s.enabled = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName(t("settings.general.display-mode"))
      .setDesc(t("settings.general.display-mode.desc"))
      .addDropdown((d) =>
        d
          .addOption("replace", t("settings.general.display-mode.replace"))
          .addOption("bilingual", t("settings.general.display-mode.bilingual"))
          .addOption("original", t("settings.general.display-mode.original"))
          .setValue(s.displayMode)
          .onChange(async (v) => {
            s.displayMode = v as typeof s.displayMode;
            await this.plugin.saveSettings();
          })
      );
    // 1.6（M1）：翻译模式（下拉——Setting API 无 radio；displayMode 同款写法）。
    // 模式 = 预设（Notice 通道跳过 + dom 高峰降级两个内部开关），经懒闭包实时读 settings
    // 热生效，无需重建组件；数字归一化两档共享
    new Setting(el)
      .setName(t("settings.general.mode"))
      .setDesc(t("settings.general.mode.desc"))
      .addDropdown((d) =>
        d
          .addOption("quality", t("settings.general.mode.quality"))
          .addOption("efficiency", t("settings.general.mode.efficiency"))
          .setValue(s.mode)
          .onChange(async (v) => {
            s.mode = v as typeof s.mode;
            await this.plugin.saveSettings();
          })
      );
    new Setting(el)
      .setName(t("settings.general.bilingual-format"))
      .setDesc(t("settings.general.bilingual-format.desc"))
      .addDropdown((d) =>
        d
          .addOption("{t} ({o})", t("settings.general.bilingual-format.t-first"))
          .addOption("{o} | {t}", t("settings.general.bilingual-format.o-first"))
          .setValue(s.bilingualFormat)
          .onChange(async (v) => {
            s.bilingualFormat = v as typeof s.bilingualFormat;
            await this.plugin.saveSettings();
          })
      );
    // 1.4 批次五（设计五节）：常用语言快速下拉置于自由文本框上方（独立 Setting，无标题行）。
    // 选中即写入 s.targetLang 并保存，保存成功后 Notice 提示（缓存按语言隔离、切回零成本）；
    // 文本框保留自由输入、恢复既有静默保存（逐键 onChange 不弹 Notice——主脑纠正卡 UX 裁定）。
    // setValue() 不触发 onChange（仅用户事件触发），互相同步安全。
    let quickLangComp: DropdownComponent | null = null;
    let targetLangComp: TextComponent | null = null;
    const quickLangSetting = new Setting(el);
    quickLangSetting.addDropdown((d) => {
      quickLangComp = d;
      d.addOption("", ""); // 当前值不在常用清单时的空位（显示为空，不误导）
      for (const lang of QUICK_LANGS) d.addOption(lang, lang);
      d.setValue(
        QUICK_LANGS.includes(s.targetLang as (typeof QUICK_LANGS)[number]) ? s.targetLang : ""
      );
      d.onChange(async (v) => {
        if (!v || v === s.targetLang) return;
        s.targetLang = v;
        targetLangComp?.setValue(v);
        await this.plugin.saveSettings();
        new Notice(t("notice.lang.switched"));
      });
    });
    const targetLangSetting = new Setting(el)
      .setName(t("settings.general.target-lang"))
      .setDesc(t("settings.general.target-lang.desc"));
    targetLangSetting.addText((text) => {
      targetLangComp = text;
      text.setValue(s.targetLang).setPlaceholder("zh-CN").onChange(async (v) => {
        s.targetLang = v.trim() || "zh-CN";
        quickLangComp?.setValue(
          QUICK_LANGS.includes(s.targetLang as (typeof QUICK_LANGS)[number]) ? s.targetLang : ""
        );
        await this.plugin.saveSettings();
      });
    });
    // 1.4：插件界面语言（auto/zh-CN/en）——onChange 走 saveSettings，refreshRuntime 内
    // setUiLocale 热生效。命令名注册期求值、重启生效（设计 4.3 已知边界）；
    // 本设置项文案已随批次四入键表（settings.general.ui-lang.*）
    new Setting(el)
      .setName(t("settings.general.ui-lang"))
      .setDesc(t("settings.general.ui-lang.desc"))
      .addDropdown((d) =>
        d
          .addOption("auto", t("settings.general.ui-lang.auto"))
          .addOption("zh-CN", t("settings.general.ui-lang.zh"))
          .addOption("en", t("settings.general.ui-lang.en"))
          .setValue(s.uiLanguage)
          .onChange(async (v) => {
            s.uiLanguage = v as typeof s.uiLanguage;
            await this.plugin.saveSettings();
          })
      );
  }

  /** API 配置：引擎选择与参数、Key、连通性测试、用量与预算（4.5） */
  private async renderApi(el: HTMLElement): Promise<void> {
    const s = this.plugin.settings;
    new Setting(el).setName(t("settings.api.engine")).addDropdown((d) => {
      for (const p of PROVIDERS) d.addOption(p.id, t(p.key));
      d.setValue(s.activeProvider).onChange(async (v) => {
        s.activeProvider = v;
        await this.plugin.saveSettings();
        await this.renderTabs();
      });
    });

    const cfg = s.providers[s.activeProvider] ?? {};
    s.providers[s.activeProvider] = cfg;

    const keySaved = await this.plugin.hasApiKey(s.activeProvider);
    new Setting(el)
      .setName("API Key")
      .setDesc(
        (this.plugin.isKeyEncryptionAvailable()
          ? t("settings.api.key.desc.encrypted")
          : t("settings.api.key.desc.plain")) +
          t("settings.api.key.status", {
            s: keySaved
              ? t("settings.api.key.status.saved")
              : t("settings.api.key.status.unsaved"),
          })
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(
            keySaved
              ? t("settings.api.key.placeholder.saved")
              : t("settings.api.key.placeholder.empty")
          )
          .onChange(async (v) => {
            await this.plugin.saveApiKey(s.activeProvider, v.trim());
            await this.renderTabs();
          });
      });

    if (s.activeProvider === "openai") {
      this.addTextSetting(el, "Base URL", t("settings.api.base-url.desc"),
        cfg.apiBaseUrl ?? "", "https://api.openai.com/v1",
        async (v) => { cfg.apiBaseUrl = v; });
      this.addTextSetting(el, t("settings.api.model"), t("settings.api.model.desc"),
        cfg.model ?? "", "gpt-4o-mini",
        async (v) => { cfg.model = v; });
      new Setting(el)
        .setName(t("settings.api.disable-thinking"))
        .setDesc(t("settings.api.disable-thinking.desc"))
        .addToggle((toggle) =>
          toggle.setValue(cfg.disableThinking ?? false).onChange(async (v) => {
            cfg.disableThinking = v;
            await this.plugin.saveSettings();
          })
        );
      // v1.3.1：token 单价改为组合输入框（修复 1.3.0 双框互斥导致价格从未保存的 bug）
      const priceCfg = cfg.pricePerMillion;
      const priceText =
        priceCfg && priceCfg.input > 0 && priceCfg.output > 0
          ? `${priceCfg.input}/${priceCfg.output}`
          : "";
      let priceEnabled = priceText !== "";
      new Setting(el)
        .setName(t("settings.api.price"))
        .setDesc(t("settings.api.price.desc"))
        .addText((text) => {
          text.setPlaceholder("2/8").setValue(priceText).onChange(async (v) => {
            const s = this.plugin.settings;
            const c = s.providers.openai ?? {};
            const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
            if (m) {
              const input = Math.min(10_000, Number(m[1]));
              const output = Math.min(10_000, Number(m[2]));
              c.pricePerMillion = { input, output };
              s.providers.openai = c;
              await this.plugin.saveSettings();
              if (!priceEnabled) {
                priceEnabled = true;
                new Notice(t("settings.api.price.notice-enabled"));
              }
            } else if (v.trim() === "") {
              delete c.pricePerMillion;
              s.providers.openai = c;
              priceEnabled = false;
              await this.plugin.saveSettings();
            }
            // 输入过程中（如 "2/"）静默等待完整格式，不保存不提示
          });
        })
        .addText((text) => {
          text.setPlaceholder("¥").setValue(cfg.priceCurrency ?? "").onChange(async (v) => {
            const s = this.plugin.settings;
            const c = s.providers.openai ?? {};
            c.priceCurrency = v.trim() || undefined;
            s.providers.openai = c;
            await this.plugin.saveSettings();
          });
        });
    } else if (s.activeProvider === "azure") {
      this.addTextSetting(el, "Region", t("settings.api.region.desc"), cfg.region ?? "", "eastasia",
        async (v) => { cfg.region = v; });
    } else if (s.activeProvider === "custom") {
      this.addTextSetting(el, t("settings.api.custom.endpoint"), t("settings.api.custom.endpoint.desc"),
        cfg.apiBaseUrl ?? "", "http://localhost:11434/v1/chat/completions",
        async (v) => { cfg.apiBaseUrl = v; });
      this.addTextSetting(el, t("settings.api.custom.model"), "", cfg.model ?? "", "",
        async (v) => { cfg.model = v; });
      new Setting(el)
        .setName(t("settings.api.custom.request-template"))
        .setDesc(t("settings.api.custom.request-template.desc"))
        .addTextArea((text) =>
          text.setValue(cfg.requestTemplate ?? "").onChange(async (v) => {
            cfg.requestTemplate = v;
            await this.plugin.saveSettings();
          })
        );
      this.addTextSetting(el, t("settings.api.custom.response-path"), t("settings.api.custom.response-path.desc"),
        cfg.responsePath ?? "", "",
        async (v) => { cfg.responsePath = v; });
    }

    new Setting(el)
      .setName(t("settings.api.connectivity"))
      .setDesc(t("settings.api.connectivity.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.api.connectivity.button")).onClick(async () => {
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
      .setName(t("settings.api.usage"))
      .setDesc(
        t("settings.api.monthly-usage.desc", {
          usage,
          basis: costBasis(),
          cost: estimateCost(usage),
        })
      );
    new Setting(el)
      .setName(t("settings.api.budget"))
      .setDesc(t("settings.api.budget.desc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text
          .setValue(s.monthlyCharBudget === null ? "" : String(s.monthlyCharBudget))
          .setPlaceholder(t("settings.api.budget.placeholder"))
          .onChange(async (v) => {
            const n = Number(v);
            s.monthlyCharBudget = v.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, Math.floor(n));
            await this.plugin.saveSettings();
          });
      });
  }

  /** 作用域：核心/社区开关、拦截器独立开关、白/黑名单（4.5 / FR-11；v1.1.5 风险标注） */
  private renderScope(el: HTMLElement): void {
    const s = this.plugin.settings;
    // 推荐用法总说明：「译」按钮是本插件的核心功能定位——写清两个按钮的精确位置（v1.1.7）
    el.createDiv({ cls: "uut-scope-note" }).setText(t("settings.scope.note"));
    new Setting(el)
      .setName(t("settings.scope.core"))
      .setDesc(t("settings.scope.core.desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.scope.core).onChange(async (v) => {
          s.scope.core = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName(t("settings.scope.community"))
      .setDesc(t("settings.scope.community.desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.scope.communityPlugins).onChange(async (v) => {
          s.scope.communityPlugins = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName(t("settings.scope.interceptors"))
      .setDesc(t("settings.scope.interceptors.desc"));
    // v1.1.5：每个通道标注功能与消耗风险（低风险 = 文本量固定且走缓存；中/高 = 随界面动态渲染持续送译）
    // 1.4 批次四：label/risk 键化，渲染时 t() 解析
    const interceptors: Array<{ key: keyof typeof s.interceptors; labelKey: string; riskKey: string }> = [
      { key: "command", labelKey: "settings.scope.ic.command", riskKey: "settings.scope.ic.command.risk" },
      { key: "menu", labelKey: "settings.scope.ic.menu", riskKey: "settings.scope.ic.menu.risk" },
      { key: "setting", labelKey: "settings.scope.ic.setting", riskKey: "settings.scope.ic.setting.risk" },
      {
        key: "dom",
        labelKey: "settings.scope.ic.dom",
        riskKey: "settings.scope.ic.dom.risk",
      },
      {
        key: "marketplace",
        labelKey: "settings.scope.ic.market",
        riskKey: "settings.scope.ic.market.risk",
      },
    ];
    for (const item of interceptors) {
      new Setting(el).setName(t(item.labelKey)).setDesc(t(item.riskKey)).addToggle((toggle) =>
        // marketplace 为 v1.1.0 新增键：旧 data.json 无此字段，?? true 兜底默认开
        toggle.setValue(s.interceptors[item.key] ?? true).onChange(async (v) => {
          s.interceptors[item.key] = v;
          await this.plugin.saveSettings();
        })
      );
    }

    this.addIdListSetting(el, t("settings.scope.whitelist"), t("settings.scope.whitelist.desc"),
      s.scope.pluginWhitelist);
    this.addIdListSetting(el, t("settings.scope.blacklist"), t("settings.scope.blacklist.desc"),
      s.scope.pluginBlacklist);

    const manifests = (
      this.app as unknown as { plugins?: { manifests?: Record<string, { id: string }> } }
    ).plugins?.manifests;
    if (manifests) {
      const ids = Object.keys(manifests).sort().join("、");
      new Setting(el).setName(t("settings.scope.installed-ids")).setDesc(ids);
    }
  }

  /** 缓存：开关、上限、统计、落盘、清理、清空、导出/导入（4.5 / FR-12；v1.1.9 说明三段式重写 + 失效条目清理 + 磁盘文件实况） */
  private async renderCache(el: HTMLElement): Promise<void> {
    const s = this.plugin.settings;
    new Setting(el)
      .setName(t("settings.cache.enable"))
      .setDesc(t("settings.cache.enable.desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.cacheEnabled).onChange(async (v) => {
          s.cacheEnabled = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName(t("settings.cache.max-entries"))
      .setDesc(t("settings.cache.max-entries.desc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(s.cacheMaxEntries)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1000 && n <= 200000) {
            s.cacheMaxEntries = Math.floor(n);
            await this.plugin.saveSettings();
          }
        });
      });
    // 1.5（B3）：宽松缓存键——跨模型/引擎复用译文（多模型试探型用户的最大 token 放大器）
    new Setting(el)
      .setName(t("settings.cache.loose-key"))
      .setDesc(t("settings.cache.loose-key.desc"))
      .addToggle((tg) =>
        tg.setValue(s.looseCacheKey).onChange(async (v) => {
          s.looseCacheKey = v;
          await this.plugin.saveSettings();
          await this.renderTabs();
        })
      );
    const stats = this.plugin.cache.stats();
    const bytes = await this.plugin.cacheFileBytes();
    const sizeInfo =
      bytes === null
        ? t("settings.cache.disk-absent")
        : t("settings.cache.disk-size", { mb: (bytes / 1024 / 1024).toFixed(2) });
    const flushInfo = stats.lastFlushAt
      ? t("settings.cache.last-flush", { time: new Date(stats.lastFlushAt).toLocaleTimeString() })
      : t("settings.cache.flush-pending");
    new Setting(el)
      .setName(t("settings.cache.stats"))
      .setDesc(
        t("settings.cache.stats.desc", {
          n: stats.size,
          rate: (stats.hitRate * 100).toFixed(1),
          size: sizeInfo,
          flush: flushInfo,
        })
      );
    new Setting(el)
      .setName(t("settings.cache.flush-now"))
      .setDesc(t("settings.cache.flush-now.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.cache.flush-now")).onClick(async () => {
          const res = await this.plugin.flushCacheNow();
          new Notice(`UUT：${res.message}`);
          await this.renderTabs();
        })
      );
    new Setting(el)
      .setName(t("settings.cache.purge-stale"))
      .setDesc(t("settings.cache.purge-stale.desc"))
      .addButton((b) => {
        b.setButtonText(t("settings.cache.purge-stale"))
          // 1.5（B3）：宽松键下条目无引擎/模型维度，清理会误删共享译文——禁用（后端同样拦截）
          .setDisabled(s.looseCacheKey)
          .onClick(async () => {
            const res = await this.plugin.purgeStaleCacheEntries();
            new Notice(`UUT：${res.message}`);
            await this.renderTabs();
          });
      });
    new Setting(el)
      .setName(t("settings.cache.clear"))
      .setDesc(t("settings.cache.clear.desc"))
      .addButton((b) => {
        b.setButtonText(t("settings.cache.clear"));
        // 1.13 起 setWarning 弃用 → setDestructive；低版本运行时特征检测回退
        const btn = b as unknown as {
          setDestructive?: () => unknown;
          setWarning?: () => unknown;
        };
        if (typeof btn.setDestructive === "function") btn.setDestructive();
        else btn.setWarning?.();
        b.onClick(async () => {
          this.plugin.cache.clear();
          this.plugin.resetCommandTranslations();
          await this.plugin.cache.flush();
          new Notice(t("settings.cache.clear.notice"));
          await this.renderTabs();
        });
      });
    new Setting(el)
      .setName(t("settings.cache.export"))
      .setDesc(t("settings.cache.export.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.cache.export.button")).onClick(async () => {
          const res = await this.plugin.exportCache();
          new Notice(`UUT：${res.message}`);
        })
      );
    const fileInput = el.createEl("input", {
      attr: { type: "file", accept: ".json,application/json" },
    });
    new Setting(el)
      .setName(t("settings.cache.import"))
      .setDesc(t("settings.cache.import.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.cache.import.button")).onClick(async () => {
          const file = fileInput.files?.[0];
          if (!file) {
            new Notice(t("settings.cache.import.no-file"));
            return;
          }
          const res = await this.plugin.importCache(await file.text());
          new Notice(`UUT：${res.message}`);
          await this.renderTabs();
        })
      );
  }

  /**
   * 用量统计（v1.1.9 起）：本月汇总卡片 + 近 30 天逐日柱状图（纯 DOM/CSS 零依赖）。
   * v1.3 双口径：token 实测（API usage 字段，账单口径，openai 通道）+ 字符折算估算（历史/其他引擎）。
   * 新增：会话速率卡片、今日实测卡片、图表口径切换、用户单价成本卡片
   */
  private async renderUsage(el: HTMLElement): Promise<void> {
    const month = await this.plugin.getUsageMonthStats();
    const monthChars = await this.plugin.monthlyUsage();
    const daily = await this.plugin.getUsageDaily(30);
    const session = this.plugin.usageSessionStats();
    const rate1 = this.plugin.usageRate(60_000);
    const rate5 = this.plugin.usageRate(5 * 60_000);
    const today = await this.plugin.usageToday();
    const isTokenBasis = this.plugin.settings.activeProvider === "openai";
    const price = this.plugin.settings.providers.openai?.pricePerMillion;
    const priceOn = !!price && price.input > 0 && price.output > 0;
    const currency = this.plugin.settings.providers.openai?.priceCurrency ?? "¥";
    const inTok = Math.ceil(month.inChars / 4);
    const outTok = Math.ceil(month.outChars / 2.5);
    const cost = this.estimateCostSplit(month.inChars, month.outChars);

    // v1.3 口径标注：让"实测"与"折算估算"的边界一目了然
    new Setting(el).setName(t("settings.usage.basis")).setDesc(
      isTokenBasis
        ? t("settings.usage.basis.token.desc")
        : t("settings.usage.basis.chars.desc")
    );

    new Setting(el)
      .setName(t("settings.usage.month"))
      .setDesc(
        t("settings.usage.month.desc", {
          calls: month.calls.toLocaleString(),
          inChars: month.inChars.toLocaleString(),
          inTok: inTok.toLocaleString(),
          outChars: month.outChars.toLocaleString(),
          outTok: outTok.toLocaleString(),
          cost,
          total: monthChars.toLocaleString(),
        })
      );

    const cards = el.createDiv("uut-usage-cards");
    const addCard = (label: string, value: string) => {
      const c = cards.createDiv("uut-usage-card");
      c.createDiv("uut-usage-card-label").setText(label);
      c.createDiv("uut-usage-card-value").setText(value);
    };
    // v1.3 会话卡片（自插件加载起的实时数据，含速率与峰值）
    addCard(t("settings.usage.card.session-tokens"), session.tokens.toLocaleString());
    addCard(
      t("settings.usage.card.session-calls"),
      t("settings.usage.card.session-calls.value", {
        n: session.calls.toLocaleString(),
        chars: fmtCompact(session.chars),
      })
    );
    addCard(
      t("settings.usage.card.rate1"),
      isTokenBasis
        ? `${fmtCompact(rate1.tokensPerMin)} tok/min`
        : t("settings.usage.card.rate-chars.value", { n: fmtCompact(rate1.charsPerMin) })
    );
    addCard(
      t("settings.usage.card.rate5"),
      isTokenBasis
        ? `${fmtCompact(rate5.tokensPerMin)} tok/min`
        : t("settings.usage.card.rate-chars.value", { n: fmtCompact(rate5.charsPerMin) })
    );
    addCard(t("settings.usage.card.peak"), `${fmtCompact(session.peakTokensPerMin)} tok/min`);
    // v1.3 今日实测卡片 + 用户单价成本
    if (isTokenBasis) {
      addCard(t("settings.usage.card.today-tokens"), (today.inTokens + today.outTokens).toLocaleString());
      if (priceOn && price) {
        const todayCost = estimateTokenCost(today.inTokens, today.outTokens, {
          inputPerMillion: price.input,
          outputPerMillion: price.output,
        });
        const monthCost = estimateTokenCost(month.inTokens ?? 0, month.outTokens ?? 0, {
          inputPerMillion: price.input,
          outputPerMillion: price.output,
        });
        addCard(t("settings.usage.card.today-cost", { currency }), fmtCost(todayCost, currency));
        addCard(t("settings.usage.card.month-cost", { currency }), fmtCost(monthCost, currency));
      }
    }
    // v1.1.9 既有估算卡片保留（非 openai 引擎与历史数据的唯一口径）
    addCard(t("settings.usage.card.month-calls"), month.calls.toLocaleString());
    addCard(t("settings.usage.card.in-tokens"), inTok.toLocaleString());
    addCard(t("settings.usage.card.out-tokens"), outTok.toLocaleString());
    addCard(t("settings.usage.card.cost"), cost);

    // 近 30 天柱状图（v1.3 口径切换：token 实测 ⇄ 字符折算）：输出（上）+ 输入（下）堆叠，窗口内最大值归一
    const tokenBasis = this.usageChartBasis === "token";
    const barIn = (d: (typeof daily)[number]) => (tokenBasis ? d.inTokens ?? 0 : Math.ceil(d.inChars / 4));
    const barOut = (d: (typeof daily)[number]) => (tokenBasis ? d.outTokens ?? 0 : Math.ceil(d.outChars / 2.5));
    const maxTok = Math.max(1, ...daily.map((d) => barIn(d) + barOut(d)));
    new Setting(el)
      .setName(
        t("settings.usage.chart.title", {
          basis: tokenBasis
            ? t("settings.usage.chart.basis-token")
            : t("settings.usage.chart.basis-est"),
        })
      )
      .setHeading();
    const toggle = el.createDiv("uut-tabbar");
    for (const [id, key] of [
      ["token", "settings.usage.chart.basis-token"],
      ["chars", "settings.usage.chart.toggle-chars"],
    ] as const) {
      const btn = toggle.createDiv(`uut-tab${this.usageChartBasis === id ? " uut-tab-active" : ""}`);
      btn.textContent = t(key);
      btn.addEventListener("click", () => {
        this.usageChartBasis = id;
        void this.renderTabs();
      });
    }
    const chart = el.createDiv("uut-chart");
    for (const d of daily) {
      const iV = barIn(d);
      const oV = barOut(d);
      const bar = chart.createDiv("uut-chart-bar");
      bar.title = t("settings.usage.chart.bar-title", {
        date: d.date,
        calls: d.calls,
        inChars: d.inChars.toLocaleString(),
        inTok: (d.inTokens ?? 0).toLocaleString(),
        outChars: d.outChars.toLocaleString(),
        outTok: (d.outTokens ?? 0).toLocaleString(),
      });
      if (oV > 0) bar.createDiv("uut-chart-out").style.height = `${(oV / maxTok) * 100}%`;
      if (iV > 0) bar.createDiv("uut-chart-in").style.height = `${(iV / maxTok) * 100}%`;
    }
    const axis = el.createDiv("uut-chart-axis");
    axis.createSpan().setText(daily[0]?.date ?? "");
    axis.createSpan().setText(daily[Math.floor(daily.length / 2)]?.date ?? "");
    axis.createSpan().setText(daily[daily.length - 1]?.date ?? "");
    const legendBasis = tokenBasis
      ? t("settings.usage.legend.actual")
      : t("settings.usage.legend.est");
    const legend = el.createDiv("uut-chart-legend");
    const lg1 = legend.createSpan();
    lg1.createSpan({ cls: "uut-chart-swatch uut-swatch-in" });
    lg1.appendText(t("settings.usage.legend.in", { basis: legendBasis }));
    const lg2 = legend.createSpan();
    lg2.createSpan({ cls: "uut-chart-swatch uut-swatch-out" });
    lg2.appendText(t("settings.usage.legend.out", { basis: legendBasis }));

    const week = daily.slice(-7).reduce(
      (acc, d) => ({
        calls: acc.calls + d.calls,
        inChars: acc.inChars + d.inChars,
        outChars: acc.outChars + d.outChars,
        inTokens: (acc.inTokens ?? 0) + (d.inTokens ?? 0),
        outTokens: (acc.outTokens ?? 0) + (d.outTokens ?? 0),
      }),
      { calls: 0, inChars: 0, outChars: 0, inTokens: 0, outTokens: 0 }
    );
    new Setting(el)
      .setName(t("settings.usage.today-week"))
      .setDesc(
        t("settings.usage.today-week.desc", {
          todayCalls: daily[daily.length - 1]?.calls ?? 0,
          todayTok: (today.inTokens + today.outTokens).toLocaleString(),
          weekCalls: week.calls.toLocaleString(),
          weekTok: ((week.inTokens ?? 0) + (week.outTokens ?? 0)).toLocaleString(),
          weekEst: (Math.ceil(week.inChars / 4) + Math.ceil(week.outChars / 2.5)).toLocaleString(),
        })
      );
    new Setting(el)
      .setName(t("settings.usage.basis-note"))
      .setDesc(t("settings.usage.basis-note.desc", { basis: costBasis() }));
  }

  /** 按基准价把输入/输出字符拆分折算为费用（比单字符口径更准；高峰价，空闲减半） */
  private estimateCostSplit(inChars: number, outChars: number): string {
    if (inChars <= 0 && outChars <= 0) return "¥0";
    const inTok = Math.ceil(inChars / 4);
    const outTok = Math.ceil(outChars / 2.5);
    const yuan = inTok * 2e-6 + outTok * 8e-6; // 高峰时段价
    if (yuan < 0.01) return t("settings.usage.split-low");
    return t("settings.usage.split-high", { peak: yuan.toFixed(2), off: (yuan / 2).toFixed(2) });
  }

  /** 高级：过滤正则、术语表、批量参数、调试模式（4.5） */
  private renderAdvanced(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el)
      .setName(t("settings.advanced.skip-patterns"))
      .setDesc(t("settings.advanced.skip-patterns.desc"))
      .addTextArea((text) =>
        text.setValue(s.skipPatterns.join("\n")).onChange(async (v) => {
          s.skipPatterns = v.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName(t("settings.advanced.glossary"))
      .setDesc(t("settings.advanced.glossary.desc"))
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
      .setName(t("settings.advanced.batch-window"))
      .setDesc(t("settings.advanced.batch-window.desc"))
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
      .setName(t("settings.advanced.max-concurrent"))
      .setDesc(t("settings.advanced.max-concurrent.desc"))
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
      .setName(t("settings.advanced.timeout"))
      .setDesc(t("settings.advanced.timeout.desc"))
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
      .setName(t("settings.advanced.debug"))
      .setDesc(t("settings.advanced.debug.desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.debugMode).onChange(async (v) => {
          s.debugMode = v;
          await this.plugin.saveSettings();
        })
      );
    // 1.6（F）：成本审计日志（默认关）——治理反馈回路配套：用户可自查"谁在烧 token"
    new Setting(el)
      .setName(t("settings.advanced.cost-audit-log"))
      .setDesc(t("settings.advanced.cost-audit-log.desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.costAuditLog).onChange(async (v) => {
          s.costAuditLog = v;
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

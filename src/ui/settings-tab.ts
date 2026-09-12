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
 * 费用估算基准（v1.1.7 换价；单一事实来源，各 Tab 共用）：
 * DeepSeek flash 系列 2026-09-10 12:00（北京时间）起，每百万 tokens：
 * 空闲时段 输入缓存命中 ¥0.02 / 未命中 ¥1 / 输出 ¥4；高峰时段为空闲 2 倍（¥0.04 / ¥2 / ¥8）。
 * 折算：输入 tokens ≈ 字符数 / 4（英文原文）；输出 tokens ≈ 字符数 / 2.5
 * （中文译文 1 token ≈ 1.5 汉字，长度约为原文 60%）。仅为量级参考，不代表账单口径。
 */
const COST_BASIS =
  "费用基准：DeepSeek flash 新定价（2026-09-10 起）每百万 tokens：空闲 输入 ¥1 / 输出 ¥4，高峰时段翻倍；API 侧缓存命中输入仅 ¥0.02–0.04";

/** 按基准价把已发送字符数折算为 tokens 分解 + 人民币费用（高峰价，空闲减半） */
function estimateCost(chars: number): string {
  if (chars <= 0) return "≈ 0 tokens，¥0";
  const inTok = Math.ceil(chars / 4);
  const outTok = Math.ceil(chars / 2.5);
  const yuan = inTok * 2e-6 + outTok * 8e-6; // 高峰时段价
  const tokText = `${(inTok + outTok).toLocaleString()} tokens（入 ${inTok.toLocaleString()} / 出 ${outTok.toLocaleString()}）`;
  if (yuan < 0.01) return `≈ ${tokText}，费用 < ¥0.01（空闲时段半价）`;
  return `≈ ${tokText}，高峰 ≈ ¥${yuan.toFixed(2)}（空闲时段半价）`;
}

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
      .setDesc(
        "总开关；未配置可用翻译引擎时拦截器不激活（设计文档 4.4.2）。" +
          "关闭后零 API 消耗；打开期间按界面渲染量消耗 API（各通道消耗量级见「作用域」分页标注）"
      )
      .addToggle((t) =>
        t.setValue(s.enabled).onChange(async (v) => {
          s.enabled = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("显示模式")
      .setDesc(
        "⚠️ 双语对照模式下回写文本更长，LLM 输出 tokens 约为纯译文的 2 倍（输出单价高于输入）；纯译文最省"
      )
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
      .setDesc("仅双语对照模式生效；对 API 消耗无影响（仅改变回写排版）")
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
      .setDesc("向当前引擎发送一次测试请求（消耗极少额度：一条短文本约几十 tokens，按基准价 < ¥0.001）")
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
      .setDesc(
        `本月已发送 ${usage} 字符（usage.json 持久化）。${COST_BASIS}；按此折算本月已消耗 ${estimateCost(usage)}（仅量级参考）`
      );
    new Setting(el)
      .setName("月度字符预算")
      .setDesc(
        "防意外烧额度的硬闸门：超限自动暂停送译、界面回退原文（4.5 熔断）。付费引擎强烈建议设置；留空为不限。" +
          "参考量级：核心界面一次性约 5–10 万字符；社区市场全量约 30 万字符/轮"
      )
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

  /** 作用域：核心/社区开关、拦截器独立开关、白/黑名单（4.5 / FR-11；v1.1.5 风险标注） */
  private renderScope(el: HTMLElement): void {
    const s = this.plugin.settings;
    // 推荐用法总说明：「译」按钮是本插件的核心功能定位——写清两个按钮的精确位置（v1.1.7）
    el.createDiv({ cls: "uut-scope-note" }).setText(
      "推荐用法——社区插件市场的「译」按钮有两个：① 左侧列表：每个插件条目的【右上角】，翻译该条目的名称+简介" +
        "（约 150 字符，费用不足 0.1 分钱）；② 右侧详情：点开任意插件后，详情区【最顶端】的「译」按钮，翻译该插件的 README 全文" +
        "（数千字符 ≈ 2,600 tokens，高峰价约 1.5 分钱，空闲时段半价）。两者译过即缓存、重复点击零成本。" +
        "绝大多数要读的英文内容是插件说明与介绍，用「译」按钮即可覆盖，无需打开下面的自动翻译开关。"
    );
    new Setting(el)
      .setName("翻译 Obsidian 核心界面")
      .setDesc(
        "低风险：核心界面文本量固定（约 5–10 万字符），一次性成本按基准价 ≈ ¥0.30 以内（空闲时段半价），缓存后零成本。" +
          "生效通道：核心命令（设置面板 / DOM 兜底通道技术上无法区分界面归属核心还是社区插件，不受此开关控制）"
      )
      .addToggle((t) =>
        t.setValue(s.scope.core).onChange(async (v) => {
          s.scope.core = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("翻译社区插件界面")
      .setDesc(
        "⚠️ 高风险（API 消耗）：开启后社区市场浏览器的可见条目会被自动翻译，滚动列表即持续送译；" +
          "市场数千条目全量约 30 万字符/轮（按基准价高峰 ≈ ¥1.1、空闲 ≈ ¥0.55），页面常驻期间反复触发——v1.1.5 起默认关闭，" +
          "建议改用条目「译」按钮。生效通道：社区插件命令、市场浏览器自动翻译（设置面板 / DOM 兜底无法归因插件，不受此开关控制）"
      )
      .addToggle((t) =>
        t.setValue(s.scope.communityPlugins).onChange(async (v) => {
          s.scope.communityPlugins = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("拦截器独立开关")
      .setDesc("单通道异常时关闭对应通道（D1 熔断手动入口）。各通道的 API 消耗量级见逐项标注");
    // v1.1.5：每个通道标注功能与消耗风险（低风险 = 文本量固定且走缓存；中/高 = 随界面动态渲染持续送译）
    const interceptors: Array<{ key: keyof typeof s.interceptors; label: string; risk: string }> = [
      { key: "command", label: "命令面板", risk: "低风险：命令清单固定，启动时预热一次，缓存后零成本" },
      { key: "menu", label: "菜单", risk: "低风险：菜单项短且重复率高，缓存命中率通常 >90%" },
      { key: "setting", label: "设置面板", risk: "低风险：各插件设置项文本量固定，翻过一次即缓存" },
      {
        key: "dom",
        label: "DOM 兜底",
        risk: "⚠️ 中风险：全局 MutationObserver 观察，动态界面（状态栏、弹窗、自定义视图）会持续送译；关闭后 Notice/弹窗等不再翻译",
      },
      {
        key: "marketplace",
        label: "社区市场「译」按钮",
        risk: "✅ 推荐：零自动消耗——按钮位置：列表条目【右上角】+ 点开插件后详情区【最顶端】；点击才翻译，缓存命中后重复点击零成本",
      },
    ];
    for (const item of interceptors) {
      new Setting(el).setName(item.label).setDesc(item.risk).addToggle((t) =>
        // marketplace 为 v1.1.0 新增键：旧 data.json 无此字段，?? true 兜底默认开
        t.setValue(s.interceptors[item.key] ?? true).onChange(async (v) => {
          s.interceptors[item.key] = v;
          await this.plugin.saveSettings();
        })
      );
    }

    this.addIdListSetting(el, "插件白名单", "非空时仅翻译这些插件（每行一个插件 id）。⚠️ 当前版本为预留配置，运行时尚未生效",
      s.scope.pluginWhitelist);
    this.addIdListSetting(el, "插件黑名单", "这些插件的命令不翻译（默认含本插件自身）。⚠️ 当前版本仅命令通道生效；设置面板 / DOM 兜底无法归因插件归属",
      s.scope.pluginBlacklist);

    const manifests = (
      this.app as unknown as { plugins?: { manifests?: Record<string, { id: string }> } }
    ).plugins?.manifests;
    if (manifests) {
      const ids = Object.keys(manifests).sort().join("、");
      new Setting(el).setName("已安装插件 id 参考").setDesc(ids);
    }
  }

  /** 缓存：开关、统计、落盘、清空、导出/导入（4.5 / FR-12；v1.1.5 风险标注与立即落盘） */
  private renderCache(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el)
      .setName("启用本地缓存")
      .setDesc(
        "译文持久化到插件目录 translation-cache.json，同一文本只付一次 API 费用。" +
          "⚠️ 关闭后每次渲染界面都重新调 API（同一界面反复消耗额度），除非排查问题否则不要关"
      )
      .addToggle((t) =>
        t.setValue(s.cacheEnabled).onChange(async (v) => {
          s.cacheEnabled = v;
          await this.plugin.saveSettings();
        })
      );
    const stats = this.plugin.cache.stats();
    const flushInfo = stats.lastFlushAt
      ? `最后落盘 ${new Date(stats.lastFlushAt).toLocaleTimeString()}`
      : "本会话尚未落盘（每 30s 检查，累计 100 条或 5 分钟自动落盘；也可点下方「立即落盘」）";
    new Setting(el)
      .setName("缓存统计")
      .setDesc(
        `条目 ${stats.size}，命中率 ${(stats.hitRate * 100).toFixed(1)}%（会话内内存统计——命中率越高，越多内容走了本地缓存、越省钱）｜文件 translation-cache.json｜${flushInfo}`
      );
    new Setting(el)
      .setName("立即落盘")
      .setDesc("把内存中的新译文立刻写入磁盘，不等自动落盘策略（崩溃/强杀最多丢失 5 分钟译文的窗口由此手动关闭）。零 API 消耗")
      .addButton((b) =>
        b.setButtonText("立即落盘").onClick(async () => {
          const res = await this.plugin.flushCacheNow();
          new Notice(`UUT：${res.message}`);
          await this.display();
        })
      );
    new Setting(el)
      .setName("清空缓存")
      .setDesc(
        "⚠️ 清空后所有界面将在下次打开时重新消耗 API 翻译一遍（按基准价：核心界面 ≈ ¥0.30 以内，空闲时段半价）。同时重置界面已显示的译文（R-07 联动）"
      )
      .addButton((b) => {
        b.setButtonText("清空缓存");
        // 1.13 起 setWarning 弃用 → setDestructive；低版本运行时特征检测回退
        const btn = b as unknown as { setDestructive?: () => unknown };
        if (typeof btn.setDestructive === "function") btn.setDestructive();
        else b.setWarning();
        b.onClick(async () => {
          this.plugin.cache.clear();
          this.plugin.resetCommandTranslations();
          await this.plugin.cache.flush();
          new Notice("UUT：缓存已清空，界面译文将在下次访问时重新翻译");
          await this.display();
        });
      });
    new Setting(el)
      .setName("导出缓存")
      .setDesc("导出到库根目录 universal-ui-translator-cache-export.json，可共享给其他用户（零 API 消耗）")
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
      .setDesc("每行一条正则；命中文本不送译（4.2.1 规则 1）。减少不必要的 API 消耗；零自身成本")
      .addTextArea((text) =>
        text.setValue(s.skipPatterns.join("\n")).onChange(async (v) => {
          s.skipPatterns = v.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("术语表（固定译法）")
      .setDesc("每行一条：原文=译文；命中直接返回，不进缓存与 API（FR-15）——省额度：命中词条零消耗")
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
      .setDesc("默认 100，可配置 50–500（4.2.2）。窗口内相同文本去重共享一次请求——调大可略微减少重复请求；对总字符消耗无影响")
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
      .setDesc("默认 3，避免触发 API 限流（4.2.2）。⚠️ 调大不省钱（总字符量不变），只影响速度；触发限流反而可能因重试多耗额度")
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
      .setDesc("默认 30000（R-23：慢引擎上调）；可配置 5000–120000（4.2.2）。超时的请求按失败处理：已发送的字符通常仍会计费")
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
      .setDesc("Console 输出拦截日志。纯本地行为，零 API 消耗")
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

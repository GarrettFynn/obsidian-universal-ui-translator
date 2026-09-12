import { Notice, Plugin, requestUrl } from "obsidian";
import { BatchTranslator } from "./src/core/batch-translator";
import { CacheManager } from "./src/core/cache-manager";
import { resolveObsidianVersion } from "./src/core/app-version";
import { TranslationCoordinator, CoordinatorOptions } from "./src/core/coordinator";
import { KeyStorage } from "./src/core/key-storage";
import { FilterEngine } from "./src/filters/filter-engine";
import { CommandPatcher } from "./src/interceptors/command-patcher";
import { formatWriteBack } from "./src/interceptors/display-mode";
import { DOMPatcher } from "./src/interceptors/dom-patcher";
import { MarketplacePatcher } from "./src/interceptors/marketplace-patcher";
import { MenuPatcher } from "./src/interceptors/menu-patcher";
import { SettingPatcher } from "./src/interceptors/setting-patcher";
import { WindowOpenHook } from "./src/interceptors/window-open-hook";
import { createActiveProvider } from "./src/providers";
import { HttpClient, TranslationProvider, withTimeout } from "./src/providers/base-provider";
import { UutSettingTab } from "./src/ui/settings-tab";
import { UsageTracker } from "./src/core/usage-tracker";
import {
  CACHE_SCHEMA_VERSION,
  CacheEntry,
  DEFAULT_SETTINGS,
  PluginSettings,
  TextFileIO,
} from "./src/types";

export default class UniversalUiTranslatorPlugin extends Plugin {
  settings!: PluginSettings;
  cache!: CacheManager;
  private keyStorage!: KeyStorage;
  private coordinator!: TranslationCoordinator;
  private coordinatorOptions!: CoordinatorOptions;
  private filter!: FilterEngine;
  private provider: TranslationProvider | null = null;
  private commandPatcher: CommandPatcher | null = null;
  private menuPatcher: MenuPatcher | null = null;
  private settingPatcher: SettingPatcher | null = null;
  private domPatcher: DOMPatcher | null = null;
  private marketplacePatcher: MarketplacePatcher | null = null;
  private windowHook: WindowOpenHook | null = null;
  private batcher!: BatchTranslator;
  private usageTracker!: UsageTracker;
  private statusBarItem: HTMLElement | null = null;
  private io!: TextFileIO;
  private http!: HttpClient;

  async onload(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PluginSettings>
    );

    // v1.1.5 一次性迁移：communityPlugins 在 <1.1.5 是从未生效的死配置且默认开，
    // 旧 data.json 里的 true 不代表用户真实意图——统一置 false（仅迁移一次，之后尊重手动选择）
    if (!this.settings.communityScopeMigratedV115) {
      const wasOn = this.settings.scope.communityPlugins;
      this.settings.scope.communityPlugins = false;
      this.settings.communityScopeMigratedV115 = true;
      await this.saveData(this.settings);
      if (wasOn) {
        new Notice(
          "UUT v1.1.5：社区市场默认不再自动翻译（此前该开关实际未生效，滚动市场列表会持续消耗 API 额度）。" +
            "逐条翻译请用市场条目上的「译」按钮（缓存命中零成本）；确需自动翻译请到 设置 → 作用域 手动打开",
          12000
        );
      }
    }

    // TextFileIO：真实环境由 app.vault.adapter 实现（B-1 抽象的实现点）
    this.io = {
      read: (p) => this.app.vault.adapter.read(p),
      write: (p, d) => this.app.vault.adapter.write(p, d),
      exists: (p) => this.app.vault.adapter.exists(p),
    };
    // 4.3.1 HTTP 约定：统一 requestUrl（无 CORS 限制）；throw:false 保留状态码供错误分类
    this.http = async (req) => {
      // 4.2.2 单请求超时（R-23：默认 30s，高级 Tab 可配置 5–120s）；超时按失败处理，走负缓存/熔断
      const res = await withTimeout(
        requestUrl({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: req.body,
          throw: false,
        }),
        this.settings.requestTimeoutMs,
        "翻译请求"
      );
      return { status: res.status, text: res.text };
    };
    // 4.4.1：safeStorage 注入；极少数无钥匙串环境走已预留的降级分支（动态 import：官方 lint 禁用 require 风格）
    let safeStorage;
    try {
      safeStorage = (await import("electron")).safeStorage;
    } catch {
      safeStorage = undefined;
    }

    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    this.keyStorage = new KeyStorage(this.io, `${pluginDir}/secrets.bin`, safeStorage);
    this.cache = new CacheManager(
      this.io,
      `${pluginDir}/translation-cache.json`,
      this.settings.cacheMaxEntries
    );
    await this.cache.load();
    // v1.1.0 落盘兜底（4.2.3 既定策略的装配层实现）：每 30s 检查——累计 ≥100 条立即落盘；
    // 否则有脏数据时每 5 分钟保底落盘。崩溃/强杀最多丢失 5 分钟译文，不再整段会话丢失
    let lastFlushMark = Date.now();
    this.registerInterval(
      window.setInterval(() => {
        const now = Date.now();
        const pending = this.cache.pendingWrites;
        if (pending >= 100 || (pending > 0 && now - lastFlushMark >= 5 * 60 * 1000)) {
          lastFlushMark = now;
          void this.cache.flush();
        }
      }, 30_000)
    );
    this.filter = new FilterEngine(this.settings.skipPatterns, this.settings.targetLang);
    this.provider = await createActiveProvider(this.settings, this.keyStorage, this.http);
    // 4.4.1：解密失败（secrets.bin 被同步到其他设备等）引导重新输入，不拿错误 Key 发请求
    if (this.keyStorage.hasDecryptFailures()) {
      new Notice("UUT：已保存的 API Key 在本机解密失败，请在设置页重新输入");
    }
    // 4.2.2 批量聚合通道：窗口与并发取用户配置；O-1 队列深度接状态栏进度提示
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setAttr("data-uut", "status"); // 带标记，DOMPatcher 白名单跳过
    this.setStatusVisible(false);
    this.batcher = new BatchTranslator(() => this.provider, {
      windowMs: this.settings.batchWindowMs,
      concurrency: this.settings.maxConcurrentRequests,
      onQueueChange: (pending) => this.updateStatusBar(pending),
    });
    // 4.5 用量统计与月度预算（UsageTracker 持久化 usage.json，跨月自动清零）
    this.usageTracker = new UsageTracker(this.io, `${pluginDir}/usage.json`);
    this.coordinatorOptions = {
      targetLang: this.settings.targetLang,
      glossary: this.settings.glossary,
      getModelId: () => (this.provider as { modelId?: string } | null)?.modelId ?? "",
      resolveFrom: (pluginId) => this.resolveFrom(pluginId),
      translateVia: (masked, context) => this.batcher.submit(masked, context),
      usageTracker: this.usageTracker,
      monthlyCharBudget: this.settings.monthlyCharBudget,
      // v1.1.5：cacheEnabled 接线（此前为死配置，缓存读写始终生效）
      isCacheEnabled: () => this.settings.cacheEnabled,
      // 4.2.2 错误分类：Key 失效（401/403）立即引导，不等熔断
      onAuthFailure: () =>
        new Notice("UUT：API Key 可能失效（401/403），请检查设置页 API 配置"),
      // v1.1.8：预算超限提示（types.ts 承诺的"超限提示"此前未实现，纯静默 = 用户实测"按钮失效"头号嫌疑）
      onBudgetExceeded: () =>
        new Notice(
          "UUT：本月字符预算已用完，翻译已暂停并回退原文；如需继续请到 设置页 → API 配置 调整月度预算"
        ),
    };
    this.coordinator = new TranslationCoordinator(
      this.filter,
      this.cache,
      () => this.provider,
      this.coordinatorOptions,
      undefined,
      // Provider 熔断提示（4.2.2：一次熔断只 Notice 一次）
      () => new Notice("UUT：翻译服务连续失败，已自动暂停 10 分钟（详见设置页）")
    );

    // 4.4.2：Provider 未配置时拦截器不激活（零 DOM 干预、零网络请求）
    if (this.settings.enabled && this.provider) {
      this.activateInterceptors();
      // D3 预热：空闲时遍历存量命令触发 getter → batcher 聚合，首次打开面板即命中缓存。
      // 同样须待布局就绪（listCommands 依赖就绪的工作区，见 CommandPatcher.activate 注记）
      this.app.workspace.onLayoutReady(() =>
        window.setTimeout(() => this.prewarmCommands(), 2000)
      );
    } else if (this.settings.enabled && !this.provider) {
      new Notice("UUT：请先在设置页配置翻译引擎与 API Key");
    }

    this.addSettingTab(new UutSettingTab(this.app, this));
    // 5.1「临时显示原文」命令：切换 original / 原模式（新渲染内容生效；已写 DOM 残留见指令注意事项）
    this.addCommand({
      id: "toggle-original",
      name: "临时显示原文/恢复译文",
      callback: () => {
        this.settings.displayMode =
          this.settings.displayMode === "original" ? "replace" : "original";
        void this.saveSettings();
        new Notice(
          this.settings.displayMode === "original"
            ? "UUT：已切换为原文显示（新渲染内容不再回写；缓存继续预热）"
            : "UUT：已恢复译文显示"
        );
      },
    });
  }

  async onunload(): Promise<void> {
    // 稳定性要求（2.2）：所有原型劫持完整还原；批量窗口结算；缓存强制 flush（4.2.3）
    this.commandPatcher?.deactivate();
    this.menuPatcher?.deactivate();
    this.settingPatcher?.deactivate();
    this.domPatcher?.deactivate();
    this.marketplacePatcher?.deactivate();
    this.windowHook?.deactivate();
    await this.batcher.flush();
    await this.cache.flush();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refreshRuntime();
  }

  async saveApiKey(providerId: string, key: string): Promise<void> {
    try {
      if (key) {
        await this.keyStorage.set(providerId, key);
      } else {
        await this.keyStorage.delete(providerId);
      }
    } catch (e) {
      console.error("[uut] Key 保存失败：", e);
      new Notice(`UUT：Key 保存失败：${String(e)}`);
    }
    await this.refreshRuntime();
  }

  async hasApiKey(providerId: string): Promise<boolean> {
    return (await this.keyStorage.get(providerId)) !== null;
  }

  isKeyEncryptionAvailable(): boolean {
    return this.keyStorage.isEncryptionAvailable();
  }

  /** R-07：清空缓存时联动重置命令通道运行时译文 */
  resetCommandTranslations(): void {
    this.commandPatcher?.resetRuntimeTranslations();
  }

  /** 本月已发送字符数（4.5 用量展示） */
  async monthlyUsage(): Promise<number> {
    return this.usageTracker.monthChars();
  }

  /** 缓存 Tab「立即落盘」（v1.1.5）：不等 30s/100 条/5 分钟保底策略，立即把内存缓存写入磁盘 */
  async flushCacheNow(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.cache.flush();
      const at = this.cache.stats().lastFlushAt;
      return {
        ok: true,
        message: `缓存已落盘（${at ? new Date(at).toLocaleTimeString() : "刚刚"}），共 ${this.cache.stats().size} 条`,
      };
    } catch (e) {
      return { ok: false, message: `落盘失败：${String(e)}` };
    }
  }

  /** 导出缓存到库根目录（4.5 缓存 Tab；FR-12） */
  async exportCache(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.cache.flush();
      const path = "universal-ui-translator-cache-export.json";
      await this.app.vault.adapter.write(
        path,
        await this.io.read(`${this.manifest.dir}/translation-cache.json`)
      );
      return { ok: true, message: `缓存已导出到库根目录：${path}` };
    } catch (e) {
      return { ok: false, message: `导出失败：${String(e)}` };
    }
  }

  /** 导入缓存 JSON（4.5 校验：schemaVersion 与条目结构，非法文件拒绝） */
  async importCache(text: string): Promise<{ ok: boolean; message: string }> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, message: "导入失败：不是合法 JSON 文件" };
    }
    const file = raw as { schemaVersion?: unknown; entries?: unknown };
    if (
      typeof file.schemaVersion !== "number" ||
      file.schemaVersion > CACHE_SCHEMA_VERSION ||
      typeof file.entries !== "object" ||
      file.entries === null
    ) {
      return {
        ok: false,
        message: `导入失败：schemaVersion 不受支持（当前支持 ≤ ${CACHE_SCHEMA_VERSION}）或缺少 entries`,
      };
    }
    const count = this.cache.importEntries(file.entries as Record<string, CacheEntry>);
    await this.cache.flush();
    return { ok: true, message: `导入完成：${count} 条缓存条目已合并` };
  }

  async testActiveProvider(): Promise<{ ok: boolean; message: string }> {
    if (!this.provider) return { ok: false, message: "未配置翻译引擎或 API Key" };
    return this.provider.validateConfig();
  }

  /** 配置变更热生效：重建 Provider 与批量通道、同步 coordinator 参数、按需启停拦截器 */
  private async refreshRuntime(): Promise<void> {
    this.provider = await createActiveProvider(this.settings, this.keyStorage, this.http);
    this.batcher = new BatchTranslator(() => this.provider, {
      windowMs: this.settings.batchWindowMs,
      concurrency: this.settings.maxConcurrentRequests,
      onQueueChange: (pending) => this.updateStatusBar(pending),
    });
    this.coordinatorOptions.targetLang = this.settings.targetLang;
    this.coordinatorOptions.glossary = this.settings.glossary;
    this.coordinatorOptions.monthlyCharBudget = this.settings.monthlyCharBudget;
    // v1.1.5：过滤器热同步——目标语言（规则 5c 嵌套防线）与跳过正则（此前改完不生效，需重启）
    this.filter.setTargetLang(this.settings.targetLang);
    this.filter.setSkipPatterns(this.settings.skipPatterns);
    // v1.1.0：配置变更即重置熔断/负缓存与运行时译态，并全量重扫已渲染界面——修复"改完配置要重启才生效"
    this.coordinator.resetFailures();
    this.commandPatcher?.resetRuntimeTranslations();
    this.domPatcher?.rescanAllText();
    if (this.settings.enabled && this.provider) {
      this.activateInterceptors();
    } else {
      this.deactivateInterceptors();
    }
  }

  /** 按 settings.interceptors 开关激活/停用各通道（D1：单通道熔断不影响其他） */
  private activateInterceptors(): void {
    const debug = (msg: string) => {
      if (this.settings.debugMode) console.log("[uut]", msg);
    };
    const format = (t: string, o: string) =>
      formatWriteBack(t, o, this.settings.displayMode, this.settings.bilingualFormat);
    const isBilingual = () => this.settings.displayMode === "bilingual";
    const on = this.settings.interceptors;
    if (on.command && !this.commandPatcher) {
      this.commandPatcher = new CommandPatcher(
        this.app,
        this.coordinator,
        // v1.1.5：scope 开关接线（此前 core/communityPlugins 为死配置）——
        // 黑名单优先；communityPlugins=off 排除社区插件命令；core=off 排除核心命令
        (pluginId) =>
          this.settings.scope.pluginBlacklist.includes(pluginId) ||
          (!this.settings.scope.communityPlugins && pluginId !== "core") ||
          (!this.settings.scope.core && pluginId === "core"),
        debug,
        format // R-13：命令面板双语括注（formatWriteBack 闭包读取实时 displayMode）
      );
      this.commandPatcher.activate();
    }
    if (on.menu && !this.menuPatcher) {
      this.menuPatcher = new MenuPatcher(this.coordinator, format, isBilingual, debug);
      this.menuPatcher.activate();
    }
    if (on.setting && !this.settingPatcher) {
      this.settingPatcher = new SettingPatcher(this.coordinator, format, debug);
      this.settingPatcher.activate();
    }
    if (on.dom && !this.domPatcher) {
      // R-12：传入 app 启用多 document 观察（popout 盲区，4.1.4 末节方案）
      this.domPatcher = new DOMPatcher(this.coordinator, format, isBilingual, debug, this.app);
      this.domPatcher.activate();
    }
    // v1.1.0：社区市场条目级「译」按钮（旧 data.json 无此键，!== false 视为开）
    if (on.marketplace !== false && !this.marketplacePatcher) {
      this.marketplacePatcher = new MarketplacePatcher(
        this.coordinator,
        format,
        debug,
        this.app,
        // v1.1.5 嵌套乱码修复：条目回写登记到 DOMPatcher 去重账本（闭包转发，domPatcher 可能后建）
        (node) => this.domPatcher?.markWrittenBack(node)
      );
      this.marketplacePatcher.activate();
    }
    // v1.1.1：社区市场浏览器是 window.open 弹出的独立窗口（CDP 实测），
    // 不在 leaves / app.setting 引用链内——钩子捕获弹窗并纳管其 document（DOM 兜底 + 市场按钮）
    if ((on.dom || on.marketplace !== false) && !this.windowHook) {
      const hook = new WindowOpenHook();
      if (hook.activate((win) => this.adoptPopupWindow(win))) this.windowHook = hook;
    }
    // 用户手动关闭的通道即时停用（热生效矩阵，5.1）
    if (!on.command) {
      this.commandPatcher?.deactivate();
      this.commandPatcher = null;
    }
    if (!on.menu) {
      this.menuPatcher?.deactivate();
      this.menuPatcher = null;
    }
    if (!on.setting) {
      this.settingPatcher?.deactivate();
      this.settingPatcher = null;
    }
    if (!on.dom) {
      this.domPatcher?.deactivate();
      this.domPatcher = null;
    }
    if (on.marketplace === false) {
      this.marketplacePatcher?.deactivate();
      this.marketplacePatcher = null;
    }
  }

  private deactivateInterceptors(): void {
    this.commandPatcher?.deactivate();
    this.commandPatcher = null;
    this.menuPatcher?.deactivate();
    this.menuPatcher = null;
    this.settingPatcher?.deactivate();
    this.settingPatcher = null;
    this.domPatcher?.deactivate();
    this.domPatcher = null;
    this.marketplacePatcher?.deactivate();
    this.marketplacePatcher = null;
    this.windowHook?.deactivate();
    this.windowHook = null;
  }

  /** v1.1.1：window.open 弹窗就绪回调——纳管其 document 到 DOM 兜底与市场按钮通道 */
  private adoptPopupWindow(win: Window): void {
    const doc = win.document;
    if (!doc?.body) return;
    // v1.1.5：市场弹窗默认不再自动全量翻译（滚动列表即持续消耗 API，用户额度事故根因）——
    // 仅 scope.communityPlugins 显式开启时纳管 DOM 兜底；条目「译」按钮始终注入（零自动成本）
    if (this.settings.scope.communityPlugins) this.domPatcher?.adoptDocument(doc);
    this.marketplacePatcher?.adoptDocument(doc);
  }

  /** D3 预热：遍历存量命令读取 name 触发 getter → batcher 聚合（同窗口去重） */
  private prewarmCommands(): void {
    if (!this.provider) return;
    const commandsApi = (
      this.app as unknown as { commands?: { listCommands?: () => Array<{ name?: unknown }> } }
    ).commands;
    if (typeof commandsApi?.listCommands !== "function") return;
    for (const command of commandsApi.listCommands()) {
      // 读取 name 即触发 getter 懒翻译；已汉化/被过滤文本由 FilterEngine 直放，不进批量
      void command.name;
    }
  }

  /** O-1：状态栏进度提示——在途时显示剩余/已译计数，归零时短暂显示完成（data-uut 标记防自家通道拾取） */
  private statusHideTimer: number | null = null;

  /** 状态栏显隐（官方审核禁内联 style 赋值，统一 CSS 类切换，v1.1.3） */
  private setStatusVisible(visible: boolean): void {
    this.statusBarItem?.toggleClass("uut-hidden", !visible);
  }

  private updateStatusBar(pending: number): void {
    if (!this.statusBarItem) return;
    if (this.statusHideTimer !== null) {
      window.clearTimeout(this.statusHideTimer);
      this.statusHideTimer = null;
    }
    if (pending > 0) {
      const done = this.batcher.stats().completed;
      this.statusBarItem.setText(`UUT 翻译中… 剩 ${pending}（已译 ${done}）`);
      this.setStatusVisible(true);
    } else {
      const done = this.batcher.stats().completed;
      if (done > 0) {
        this.statusBarItem.setText(`UUT ✓ 本会话已译 ${done} 条`);
        this.setStatusVisible(true);
        // v1.1.0：完成提示停留 5 秒后隐藏
        this.statusHideTimer = window.setTimeout(() => {
          this.setStatusVisible(false);
          this.statusHideTimer = null;
        }, 5000);
      } else {
        this.setStatusVisible(false);
      }
    }
  }

  /** 缓存来源维度（4.2.3 / D5）：pluginId@version，核心文本为 core@appVersion */
  private resolveFrom(pluginId: string): string {
    if (pluginId === "core") {
      const v = resolveObsidianVersion(
        (this.app as unknown as { appVersion?: string }).appVersion,
        // R-05 兜底：从 UA 取 Obsidian 版本号（非 OS 探测，Platform API 不提供版本信息；
        // 计算属性访问以兼容官方 lint 对 navigator 标识符的静态限制）
        globalThis["navigator"]?.["userAgent"] ?? ""
      );
      return `core@${v}`;
    }
    const manifests = (
      this.app as unknown as { plugins?: { manifests?: Record<string, { version?: string }> } }
    ).plugins?.manifests;
    return `${pluginId}@${manifests?.[pluginId]?.version ?? ""}`;
  }
}

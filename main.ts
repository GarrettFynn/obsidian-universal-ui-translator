import { Notice, Plugin, moment, requestUrl } from "obsidian";
import { BatchTranslator } from "./src/core/batch-translator";
import { CacheManager } from "./src/core/cache-manager";
import { TranslationCoordinator, CoordinatorOptions } from "./src/core/coordinator";
import { KeyStorage } from "./src/core/key-storage";
import { Semaphore } from "./src/core/semaphore";
import { estimateTokenCost, fmtCompact, fmtCost } from "./src/core/format";
import { FilterEngine } from "./src/filters/filter-engine";
import { resolveUiLocale, setUiLocale, t } from "./src/i18n";
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
  SyncFileIO,
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
  /** v1.3：用量速率状态栏段（与翻译进度段独立并存） */
  private usageBarItem: HTMLElement | null = null;
  private lastUsageBarText = "";
  private io!: TextFileIO;
  /** 1.5（F1）：卸载同步落盘 IO（Node fs；isDesktopOnly=true 保证可用） */
  private syncIO!: SyncFileIO;
  /** 1.5（F2）：上一回调的队列深度（>0→0 边沿检测；字段而非局部——refreshRuntime 重建 batcher 后状态延续） */
  private prevQueuePending = 0;
  private http!: HttpClient;
  /** A2：全局请求信号量——maxConcurrentRequests = 真实在途 HTTP 请求数（所有引擎统一） */
  private requestSemaphore!: Semaphore;

  async onload(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PluginSettings>
    );

    // 1.4：界面语言 onload 首调（此后每次配置变更经 refreshRuntime 热同步）——
    // 提前于 v1.1.5 迁移 Notice，使 onload 期间的提示文案同样遵循界面语言
    setUiLocale(resolveUiLocale(this.settings.uiLanguage, moment.locale()));

    // v1.1.5 一次性迁移：communityPlugins 在 <1.1.5 是从未生效的死配置且默认开，
    // 旧 data.json 里的 true 不代表用户真实意图——统一置 false（仅迁移一次，之后尊重手动选择）
    if (!this.settings.communityScopeMigratedV115) {
      const wasOn = this.settings.scope.communityPlugins;
      this.settings.scope.communityPlugins = false;
      this.settings.communityScopeMigratedV115 = true;
      await this.saveData(this.settings);
      if (wasOn) {
        new Notice(t("notice.migrate-v115") + t("notice.migrate-v115-hint"), 12000);
      }
    }

    // TextFileIO：真实环境由 app.vault.adapter 实现（B-1 抽象的实现点）
    this.io = {
      read: (p) => this.app.vault.adapter.read(p),
      write: (p, d) => this.app.vault.adapter.write(p, d),
      exists: (p) => this.app.vault.adapter.exists(p),
    };
    // 1.5（F1）：卸载同步落盘 IO——Node fs writeSync+renameSync 原子替换（adapter 无同步写口）。
    // basePath 拿不到（网络库等）或 fs 不可达时留 no-op：flushSync 会失败并回落异步 flush（尽力而为）。
    // 实测（1022 冒烟）：Electron renderer 的原生 ESM import 不解析 Node 内置模块
    // （import("fs") 抛 "Failed to resolve module specifier"），nodeIntegration 下
    // globalThis.require 可用——双路探测，ESM 优先、require 回落
    try {
      let fsMod: typeof import("fs") | undefined;
      try {
        fsMod = await import("fs");
      } catch {
        const rq = (globalThis as { require?: (id: string) => typeof import("fs") }).require;
        if (typeof rq === "function") fsMod = rq("fs");
      }
      const basePath = (this.app.vault.adapter as { basePath?: string }).basePath;
      this.syncIO =
        fsMod && basePath
          ? {
              writeSync: (p, d) => fsMod.writeFileSync(`${basePath}/${p}`, d, "utf8"),
              renameSync: (f, to) => fsMod.renameSync(`${basePath}/${f}`, `${basePath}/${to}`),
            }
          : { writeSync: () => undefined, renameSync: () => undefined };
    } catch {
      this.syncIO = { writeSync: () => undefined, renameSync: () => undefined };
    }
    // 4.3.1 HTTP 约定：统一 requestUrl（无 CORS 限制）；throw:false 保留状态码供错误分类
    // A2：先获取信号量再起超时（排队时间不吃超时预算）；真实在途 = maxConcurrentRequests
    this.requestSemaphore = new Semaphore(() => this.settings.maxConcurrentRequests);
    this.http = async (req) => {
      await this.requestSemaphore.acquire();
      try {
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
          t("common.timeout-request")
        );
        return { status: res.status, text: res.text };
      } finally {
        this.requestSemaphore.release();
      }
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
      // v1.1.9：内存=磁盘同上限（原双层设计的磁盘侧因 flush 只写内存而不可达）
      this.settings.cacheMaxEntries,
      this.settings.cacheMaxEntries
    );
    await this.cache.load();
    // v1.1.0 落盘兜底（4.2.3 既定策略的装配层实现）：每 30s 检查——累计 ≥100 条立即落盘；
    // 否则有脏数据（含命中刷新的访问时间，B2 accessedSinceFlush）时 30s 保底落盘（v1.2 B4：
    // 原 5 分钟——崩溃丢失窗口过大；写入频率仍受 30s 轮询节流，.bak 复制另有 5 分钟节流）
    let lastFlushMark = Date.now();
    this.registerInterval(
      window.setInterval(() => {
        const now = Date.now();
        const pending = this.cache.pendingWrites;
        if (
          pending >= 100 ||
          ((pending > 0 || this.cache.accessedSinceFlush) && now - lastFlushMark >= 30_000)
        ) {
          lastFlushMark = now;
          void this.cache.flush();
        }
      }, 30_000)
    );
    this.filter = new FilterEngine(this.settings.skipPatterns, this.settings.targetLang);
    this.provider = await createActiveProvider(
      this.settings,
      this.keyStorage,
      this.http,
      // v1.3：响应 usage 字段回传真实账单口径 token（合批一次即整批；网关缺失时静默）
      (u) => void this.usageTracker.recordTokens(u.promptTokens, u.completionTokens)
    );
    // 4.4.1：解密失败（secrets.bin 被同步到其他设备等）引导重新输入，不拿错误 Key 发请求
    if (this.keyStorage.hasDecryptFailures()) {
      new Notice(t("notice.key-decrypt-failed"));
    }
    // 4.2.2 批量聚合通道：窗口与并发取用户配置；O-1 队列深度接状态栏进度提示
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setAttr("data-uut", "status"); // 带标记，DOMPatcher 白名单跳过
    this.setStatusVisible(false);
    // v1.3：用量速率状态栏段（1Hz setText；字符串未变化时跳过，避免无意义文本节点更新）
    this.usageBarItem = this.addStatusBarItem();
    this.usageBarItem.setAttr("data-uut", "usage");
    this.usageBarItem.toggleClass("uut-hidden", true);
    this.registerInterval(
      window.setInterval(() => void this.updateUsageStatusBar(), 1000)
    );
    this.batcher = new BatchTranslator(() => this.provider, {
      windowMs: this.settings.batchWindowMs,
      concurrency: this.settings.maxConcurrentRequests,
      onQueueChange: (pending) => {
        this.updateStatusBar(pending);
        // 1.5（F2）：批次全部结算（>0→0 边沿）且有脏数据、距上次落盘 ≥5s → 节流落盘。
        // 真机实证（1022-1427）：30s 轮询窗口 30~60s，翻译完立即关闭即丢——把窗口压到 ≤5s
        if (this.prevQueuePending > 0 && pending === 0 && this.cache.pendingWrites > 0) {
          const last = this.cache.stats().lastFlushAt ?? 0;
          if (Date.now() - last >= 5000) void this.cache.flush();
        }
        this.prevQueuePending = pending;
      },
    });
    // 4.5 用量统计与月度预算（UsageTracker 持久化 usage.json，跨月自动清零）
    this.usageTracker = new UsageTracker(this.io, `${pluginDir}/usage.json`);
    this.coordinatorOptions = {
      targetLang: this.settings.targetLang,
      glossary: this.settings.glossary,
      getModelId: () => (this.provider as { modelId?: string } | null)?.modelId ?? "",
      translateVia: (masked, context) => this.batcher.submit(masked, context),
      usageTracker: this.usageTracker,
      monthlyCharBudget: this.settings.monthlyCharBudget,
      // v1.1.5：cacheEnabled 接线（此前为死配置，缓存读写始终生效）
      isCacheEnabled: () => this.settings.cacheEnabled,
      // 1.5（B3）：宽松缓存键开关（开时键去引擎/模型维度，跨模型复用译文）
      isLooseCacheKey: () => this.settings.looseCacheKey,
      // 1.6（E1）：dom 高峰降级（效率档）——队列深度 > 30 时 dom 兜底通道暂停发新 API 请求
      // （仅回写已缓存内容）。必须经 this 调用期取 batcher：refreshRuntime 会重建实例，
      // 构造期捕获会读到旧实例（冷读终审钉死的装配红线）
      shouldThrottleDom:
        () =>
          this.settings.mode === "efficiency" &&
          (this.batcher?.pendingCount() ?? 0) > 30,
      // 1.6（F）：成本审计日志（默认关）——懒闭包实时读 settings，开关热生效
      isCostAuditLog: () => this.settings.costAuditLog,
      // 4.2.2 错误分类：Key 失效（401/403）立即引导，不等熔断
      onAuthFailure: () => new Notice(t("notice.auth-failed")),
      // v1.1.8：预算超限提示（types.ts 承诺的"超限提示"此前未实现，纯静默 = 用户实测"按钮失效"头号嫌疑）
      onBudgetExceeded: () => new Notice(t("notice.budget-exceeded")),
    };
    this.coordinator = new TranslationCoordinator(
      this.filter,
      this.cache,
      () => this.provider,
      this.coordinatorOptions,
      undefined,
      // Provider 熔断提示（4.2.2：一次熔断只 Notice 一次）；
      // v1.2 A3：同时启动状态栏倒计时（此前只有一次性 Notice，用户不知道熔断还要多久）
      () => {
        new Notice(t("notice.circuit-open"));
        this.startCircuitCountdown();
      }
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
      new Notice(t("notice.setup-required"));
    }

    this.addSettingTab(new UutSettingTab(this.app, this));
    // 5.1「临时显示原文」命令：切换 original / 原模式（新渲染内容生效；已写 DOM 残留见指令注意事项）
    // 1.4：命令名注册时求值——切换界面语言后重启生效（Obsidian 命令注册表限制，设计 4.3 已知边界）
    this.addCommand({
      id: "toggle-original",
      name: t("command.toggle-original"),
      callback: () => {
        this.settings.displayMode =
          this.settings.displayMode === "original" ? "replace" : "original";
        void this.saveSettings();
        new Notice(
          this.settings.displayMode === "original"
            ? t("notice.original-on")
            : t("notice.original-off")
        );
      },
    });
  }

  onunload(): void {
    // 稳定性要求（2.2）：所有原型劫持完整还原；批量窗口结算与缓存 flush 异步发起、不阻塞卸载（4.2.3）
    this.stopCircuitCountdown();
    this.commandPatcher?.deactivate();
    this.menuPatcher?.deactivate();
    this.settingPatcher?.deactivate();
    this.domPatcher?.deactivate();
    this.marketplacePatcher?.deactivate();
    this.windowHook?.deactivate();
    void this.batcher.flush();
    // 1.5（F1）：卸载同步落盘——真机实证（1022-1427 E4/E5）onunload 的 void flush() 在
    // 强杀与优雅关闭下都来不及完成，翻译成功未落盘的译文即丢失；Node fs 同步写+原子
    // rename 是唯一可靠兜底。同步失败（网络库等）回落原异步路径（尽力而为）
    if (!this.cache.flushSync(this.syncIO)) {
      void this.cache.flush();
    }
    // v1.2 B4：用量统计去抖落盘的兜底结算
    void this.usageTracker.flush();
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
      console.error(t("common.log-key-save-failed"), e);
      new Notice(t("notice.key-save-failed", { n: String(e) }));
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

  /** 本月已发送字符数（4.5 用量展示；月度预算同口径） */
  async monthlyUsage(): Promise<number> {
    return this.usageTracker.monthChars();
  }

  /** 用量统计分页（v1.1.9）：近 N 天逐日明细（送译条数 + 输入/输出字符，缺日补零） */
  async getUsageDaily(days: number) {
    return this.usageTracker.dailyStats(days);
  }

  /** 用量统计分页（v1.1.9）：本月日桶合计（逐日明细自 v1.1.9 起记录，历史月份只有月累计） */
  async getUsageMonthStats() {
    return this.usageTracker.monthStats();
  }

  /** 用量分页转发（v1.3）：会话统计 / 窗口速率 / 今日用量（in/out token 拆分） */
  usageSessionStats() {
    return this.usageTracker.sessionStats();
  }

  usageRate(windowMs: number) {
    return this.usageTracker.ratePerMinute(windowMs);
  }

  async usageToday() {
    return this.usageTracker.todayUsage();
  }

  /**
   * v1.3.1 用量文案统一供数（1Hz，状态栏与市场弹窗徽标同源）：
   * - bar：主窗口状态栏文本——10 分钟无活动返回 null（隐藏），活动时含速率段
   * - badge：市场弹窗常驻徽标——不设空闲门控（弹窗内唯一消耗视图），速率段仅活动时出现
   */
  private async usageStatusTexts(): Promise<{ bar: string | null; badge: string | null }> {
    if (!this.settings.usageInStatusBar || !this.provider) return { bar: null, badge: null };
    const last = this.usageTracker.lastActivityAt();
    const idle = last === null || Date.now() - last > 10 * 60 * 1000;
    const rate = this.usageTracker.ratePerMinute(60_000);
    const today = await this.usageTracker.todayUsage();
    const price = this.settings.providers["openai"]?.pricePerMillion;
    let badge: string;
    let ratePart = "";
    if (this.provider.id === "openai") {
      const todayTokens = today.inTokens + today.outTokens;
      if (rate.tokensPerMin >= 1) ratePart = `▲ ${fmtCompact(rate.tokensPerMin)} tok/min · `;
      badge = t("status.today-tokens", { n: fmtCompact(todayTokens) });
      if (price && price.input > 0 && price.output > 0) {
        const cost = estimateTokenCost(today.inTokens, today.outTokens, {
          inputPerMillion: price.input,
          outputPerMillion: price.output,
        });
        const currency = this.settings.providers["openai"]?.priceCurrency ?? "¥";
        badge += ` · ≈${fmtCost(cost, currency)}`;
      }
    } else {
      if (rate.charsPerMin >= 1)
        ratePart = t("status.rate-chars", { n: fmtCompact(rate.charsPerMin) });
      badge = t("status.today-chars", { n: fmtCompact(today.chars) });
    }
    return { bar: idle ? null : `${ratePart}${badge}`, badge };
  }

  /**
   * v1.3 用量速率状态栏段（1Hz）：openai 引擎 token 口径（配价时附今日费用估算），
   * 其他引擎字符口径；10 分钟无活动隐藏。费用仅在用户配置单价后显示（口径可控）。
   */
  private async updateUsageStatusBar(): Promise<void> {
    if (!this.usageBarItem) return;
    const { bar, badge } = await this.usageStatusTexts();
    // 市场弹窗徽标同源供数（独立窗口内唯一消耗视图）
    this.marketplacePatcher?.setUsageLine(badge);
    if (bar === null) {
      if (this.lastUsageBarText !== "") {
        this.usageBarItem.toggleClass("uut-hidden", true);
        this.lastUsageBarText = "";
      }
      return;
    }
    if (bar !== this.lastUsageBarText) {
      this.usageBarItem.setText(bar);
      this.usageBarItem.toggleClass("uut-hidden", false);
      this.lastUsageBarText = bar;
    }
  }

  /** 缓存 Tab 实况（v1.1.9）：磁盘缓存文件字节数；文件不存在或读取失败返回 null */
  async cacheFileBytes(): Promise<number | null> {
    try {
      const st = await this.app.vault.adapter.stat(
        `${this.manifest.dir}/translation-cache.json`
      );
      return st?.size ?? null;
    } catch {
      return null;
    }
  }

  /** 缓存 Tab「清理失效条目」（v1.1.9）：删除与当前 引擎+语言+模型 不匹配的条目（换模型后旧条目永不命中） */
  async purgeStaleCacheEntries(): Promise<{ ok: boolean; message: string }> {
    if (!this.provider) {
      return { ok: false, message: t("common.purge-no-engine") };
    }
    // 1.5（B3）：宽松缓存键下条目无引擎/模型维度可判——清理会误删共享条目，禁用并说明
    if (this.settings.looseCacheKey) {
      return { ok: false, message: t("status.cache-purge-loose") };
    }
    const model = (this.provider as { modelId?: string }).modelId ?? "";
    const removed = this.cache.purgeMismatched(
      this.provider.id,
      this.settings.targetLang,
      model
    );
    await this.cache.flush();
    return {
      ok: true,
      message: t("status.cache-purged", { n: removed }),
    };
  }

  /** 缓存 Tab「立即落盘」（v1.1.5）：不等 30s/100 条/5 分钟保底策略，立即把内存缓存写入磁盘 */
  async flushCacheNow(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.cache.flush();
      const at = this.cache.stats().lastFlushAt;
      return {
        ok: true,
        message: t("status.cache-flushed", {
          time: at ? new Date(at).toLocaleTimeString() : t("status.just-now"),
          n: this.cache.stats().size,
        }),
      };
    } catch (e) {
      return { ok: false, message: t("status.flush-failed", { n: String(e) }) };
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
      return { ok: true, message: t("status.cache-exported", { n: path }) };
    } catch (e) {
      return { ok: false, message: t("status.export-failed", { n: String(e) }) };
    }
  }

  /** 导入缓存 JSON（4.5 校验：schemaVersion 与条目结构，非法文件拒绝） */
  async importCache(text: string): Promise<{ ok: boolean; message: string }> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, message: t("status.import-bad-json") };
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
        message: t("status.import-schema-unsupported", { n: CACHE_SCHEMA_VERSION }),
      };
    }
    const count = this.cache.importEntries(file.entries as Record<string, CacheEntry>);
    await this.cache.flush();
    return { ok: true, message: t("status.import-done", { n: count }) };
  }

  async testActiveProvider(): Promise<{ ok: boolean; message: string }> {
    if (!this.provider) return { ok: false, message: t("common.no-engine-or-key") };
    return this.provider.validateConfig();
  }

  /** 配置变更热生效：重建 Provider 与批量通道、同步 coordinator 参数、按需启停拦截器 */
  private async refreshRuntime(): Promise<void> {
    // 1.4：界面语言热生效（跟随/中文/英文切换即生效；命令名重启生效为已知边界）
    setUiLocale(resolveUiLocale(this.settings.uiLanguage, moment.locale()));
    this.provider = await createActiveProvider(
      this.settings,
      this.keyStorage,
      this.http,
      (u) => void this.usageTracker.recordTokens(u.promptTokens, u.completionTokens)
    );
    this.batcher = new BatchTranslator(() => this.provider, {
      windowMs: this.settings.batchWindowMs,
      concurrency: this.settings.maxConcurrentRequests,
      onQueueChange: (pending) => {
        this.updateStatusBar(pending);
        // 1.5（F2）：批次全部结算（>0→0 边沿）且有脏数据、距上次落盘 ≥5s → 节流落盘。
        // 真机实证（1022-1427）：30s 轮询窗口 30~60s，翻译完立即关闭即丢——把窗口压到 ≤5s
        if (this.prevQueuePending > 0 && pending === 0 && this.cache.pendingWrites > 0) {
          const last = this.cache.stats().lastFlushAt ?? 0;
          if (Date.now() - last >= 5000) void this.cache.flush();
        }
        this.prevQueuePending = pending;
      },
    });
    this.coordinatorOptions.targetLang = this.settings.targetLang;
    this.coordinatorOptions.glossary = this.settings.glossary;
    this.coordinatorOptions.monthlyCharBudget = this.settings.monthlyCharBudget;
    // v1.1.5：过滤器热同步——目标语言（规则 5c 嵌套防线）与跳过正则（此前改完不生效，需重启）
    this.filter.setTargetLang(this.settings.targetLang);
    this.filter.setSkipPatterns(this.settings.skipPatterns);
    // v1.1.9：缓存容量上限热生效（调小立即淘汰最旧条目）
    this.cache.setMaxEntries(this.settings.cacheMaxEntries);
    // v1.1.0：配置变更即重置熔断/负缓存与运行时译态，并全量重扫已渲染界面——修复"改完配置要重启才生效"
    this.coordinator.resetFailures();
    this.stopCircuitCountdown();
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
      // 1.6（A/M1）：skipNotice 尾参——效率档跳过 Notice 通道；懒闭包实时读 settings，
      // 模式切换经 saveSettings→refreshRuntime→rescanAllText 热生效，无需重建组件
      this.domPatcher = new DOMPatcher(
        this.coordinator,
        format,
        isBilingual,
        debug,
        this.app,
        undefined,
        () => this.settings.mode === "efficiency"
      );
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

  /** v1.2 A3：熔断倒计时定时器（状态栏常驻 mm:ss；到期/复位/卸载清除） */
  private circuitTimer: number | null = null;

  private startCircuitCountdown(): void {
    if (this.circuitTimer !== null) return;
    const tick = () => {
      const remain = this.coordinator.circuitRemainingMs();
      if (remain <= 0 || !this.statusBarItem) {
        this.stopCircuitCountdown();
        return;
      }
      const mm = String(Math.floor(remain / 60_000)).padStart(2, "0");
      const ss = String(Math.floor((remain % 60_000) / 1000)).padStart(2, "0");
      this.statusBarItem.setText(t("status.circuit-countdown", { n: mm, m: ss }));
      this.setStatusVisible(true);
    };
    tick();
    this.circuitTimer = window.setInterval(tick, 1000);
  }

  private stopCircuitCountdown(): void {
    if (this.circuitTimer !== null) {
      window.clearInterval(this.circuitTimer);
      this.circuitTimer = null;
    }
  }

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
      this.statusBarItem.setText(t("status.translating", { n: pending, m: done }));
      this.setStatusVisible(true);
    } else {
      const done = this.batcher.stats().completed;
      if (done > 0) {
        this.statusBarItem.setText(t("status.session-done", { n: done }));
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

  /** 缓存来源维度（4.2.3 / D5）已随 v1.2 B1 退役：缓存键已锚定原文文本，
   *  来源版本失效只误伤升级后未变的条目（整批重译的根因），app-version 模块随之删除 */
}

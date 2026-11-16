import { CacheManager } from "./cache-manager";
import { FilterEngine } from "../filters/filter-engine";
import { TranslationProvider } from "../providers/base-provider";
import { t } from "../i18n";
import type { TranslateContext } from "../types";

const NEGATIVE_TTL_MS = 5 * 60 * 1000; // 负缓存：失败文本 5 分钟内不再请求（4.2.2）
const CIRCUIT_FAILURE_THRESHOLD = 5; // 连续 5 次失败触发 Provider 熔断
const CIRCUIT_OPEN_MS = 10 * 60 * 1000; // 熔断持续 10 分钟

/** v1.1.8：翻译结果分类——手动通道（市场「译」按钮）据此区分"无待译"与"失败"，不再把失败显示成成功 */
export type TranslateOutcome =
  | "translated"
  | "cache"
  | "glossary"
  | "filtered"
  | "no-provider"
  | "budget"
  | "circuit"
  | "negative-cache"
  /** 1.5（F3）：cacheOnly 模式下未命中缓存——不发 API，原文返回（弹窗重开自动回写专用） */
  | "cache-miss"
  /** 1.6（E1）：dom 兜底通道高峰降级——效率档 + 队列超阈值时不发 API 原文返回
   *  （不写缓存不进负缓存，队列深度回落即恢复；仅 pluginId="unknown" 触发） */
  | "throttled"
  | "failed";

export interface TranslateResult {
  /** 译文；任何失败路径回退为原文（优雅降级原则不变） */
  text: string;
  outcome: TranslateOutcome;
  /** outcome === "failed" 时的错误摘要（截断 160 字符） */
  error?: string;
}

export interface CoordinatorOptions {
  targetLang: string;
  /** FR-15 术语表：原文 → 固定译文，优先于缓存与 API */
  glossary: Record<string, string>;
  /** 当前模型 id（进入缓存键维度，4.2.3） */
  getModelId?: () => string;
  /** 批量通道（4.2.2 BatchTranslator，装配层注入）；缺省时逐条直调 provider.translate */
  translateVia?: (masked: string, context?: string) => Promise<string>;
  /** 用量统计（4.5，装配层注入 UsageTracker）；缺省时不计量 */
  usageTracker?: {
    /** chars=送译字符数；outChars=译文长度（v1.1.9 逐日明细输入/输出拆分） */
    record(chars: number, outChars?: number): Promise<void>;
    isOverBudget(budget: number | null): Promise<boolean>;
  };
  /** 月度字符预算（4.5）；null/缺省为不限 */
  monthlyCharBudget?: number | null;
  /** Key 失效（401/403）提示回调（4.2.2 错误分类；一次会话只提示一次） */
  onAuthFailure?: () => void;
  /** 缓存总开关（4.4 cacheEnabled，v1.1.5 接线——此前为死配置）；缺省视为开启 */
  isCacheEnabled?: () => boolean;
  /** 1.5（B3）：宽松缓存键开关——开时键退化为 sha256(原文+目标语言)，跨引擎/模型复用译文 */
  isLooseCacheKey?: () => boolean;
  /** 1.6（E1）：dom 兜底通道高峰降级开关——返回 true 时 source=dom + pluginId=unknown 的
   *  请求不发 API（outcome "throttled"）。装配层实现：效率档 && batcher.pendingCount() > 30
   *  （懒闭包实时读 settings；batcher 须经 this 调用期取，refreshRuntime 会重建实例） */
  shouldThrottleDom?: () => boolean;
  /** 1.6（F）：成本审计日志开关——开启时每条送 API 的请求打 console 明细（默认关） */
  isCostAuditLog?: () => boolean;
  /** v1.1.8：月度预算超限提示回调（4.5 承诺的"超限提示"此前未实现；一次会话只提示一次） */
  onBudgetExceeded?: () => void;
}

/**
 * 翻译请求统一入口（设计文档 3.2 数据流、3.3 模块清单）
 * 编排：FilterEngine → Glossary → maskAll（1.6 C1 显式占位符+数字单趟联合 token 化）→
 *       CacheManager（键与条目均锚定 masked）→ Provider → 还原校验（1.6 C2）→ 写缓存
 * 任何环节失败回退原文，绝不向拦截层抛异常（优雅降级原则）
 */
export class TranslationCoordinator {
  private negativeCache = new Map<string, number>();
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private authNotified = false;
  private budgetNotified = false;

  constructor(
    private filter: FilterEngine,
    private cache: CacheManager,
    private getProvider: () => TranslationProvider | null,
    private options: CoordinatorOptions,
    private now: () => number = () => Date.now(),
    /** 熔断触发回调（装配层注入 Notice 提示；一次熔断只回调一次） */
    private onCircuitOpen?: () => void
  ) {}

  async translate(text: string, ctx: TranslateContext): Promise<string> {
    return (await this.translateWithOutcome(text, ctx)).text;
  }

  /**
   * v1.1.8：带结果分类的翻译入口（市场「译」按钮等手动通道使用）——
   * 行为与 translate() 完全一致，额外返回 outcome 让调用方能区分"无待译"与"失败"，
   * 不再把失败静默显示成成功（用户实测"点击无反应"的根因）
   * @param opts.bypassNegativeCache 手动点击 = 显式重试意图，跳过 5 分钟负缓存；
   *   熔断与预算不受影响（钱包保护不动）
   * @param opts.cacheOnly 1.5（F3）：只查 过滤→术语表→缓存，未命中直接原文返回（outcome
   *   "cache-miss"），不发任何 API——弹窗重开时自动回写已译内容用，零 token 成本
   */
  async translateWithOutcome(
    text: string,
    ctx: TranslateContext,
    opts?: { bypassNegativeCache?: boolean; cacheOnly?: boolean }
  ): Promise<TranslateResult> {
    // 1. 过滤链（4.2.1）
    if (!this.filter.shouldTranslate(text)) return { text, outcome: "filtered" };
    // 2. 术语表前置（FR-15）
    const fixed = this.options.glossary[text];
    if (fixed) return { text: fixed, outcome: "glossary" };
    // 3. Provider 未配置：回退原文（4.4.2 未配置行为）
    const provider = this.getProvider();
    if (!provider) return { text, outcome: "no-provider" };
    // 4. 1.6（C1/C3）：单趟联合 mask（显式占位符 + 裸数字统一编号，filter-engine.maskAll）——
    //    缓存键、负缓存与缓存条目均锚定 masked：动态数字模板（"New preset: 540/1234" 型）
    //    共享一个键，命中时按当前原文 spans 还原各自正确数字（1234 张图只付一次钱）
    const { masked, spans, numericValues } = FilterEngine.maskAll(text);
    // 缓存（键含 providerId + targetLang + model 维度，4.2.3；v1.1.5 cacheEnabled 接线；
    // v1.2 B1 来源版本维度退役；1.5 B3 宽松键——1.6 起同样吃 masked 输入，跨模型复用模板译文）
    const cacheOn = this.options.isCacheEnabled?.() ?? true;
    const model = this.options.getModelId?.() ?? "";
    const key = this.options.isLooseCacheKey?.()
      ? CacheManager.makeLooseKey(masked, this.options.targetLang)
      : CacheManager.makeKey(masked, provider.id, this.options.targetLang, model);
    const hit = cacheOn ? this.cache.get(key) : null;
    if (hit) {
      // 1.6（C2）：缓存条目存 masked 态译文——按当前原文 spans 还原；违例（模型吞/幻觉
      // token 的残缺条目）视同未命中继续走 API（cacheOnly 请求在下面被拦成 cache-miss）
      const cached = FilterEngine.validateAndRestore(hit.tgt, spans, numericValues);
      if (cached !== null) return { text: cached, outcome: "cache" };
    }
    // F3：cache-only 到此为止——未命中不发 API（自动回写通道零成本约束）
    if (opts?.cacheOnly) return { text, outcome: "cache-miss" };
    // 1.6（E1）：dom 兜底通道高峰降级——效率档 + 队列超阈值时不发 API（预算检查之前，
    // 高峰期连预算统计口径的请求都不发）。pluginId === "unknown" 甄别必须保留：市场手动趟
    // 与 cacheOnlyPass 同样传 source:"dom"（pluginId:"marketplace"），漏甄别会误伤主动通道；
    // cacheOnly 请求已在上一行返回，永不触达本分支。不写缓存不进负缓存——队列深度回落即恢复
    if (
      ctx.source === "dom" &&
      ctx.pluginId === "unknown" &&
      this.options.shouldThrottleDom?.()
    ) {
      return { text, outcome: "throttled" };
    }
    // 4.5 月度预算熔断：超限暂停送译、回退原文（v1.1.8：每会话提示一次——此前纯静默）
    if (
      this.options.usageTracker &&
      (await this.options.usageTracker.isOverBudget(this.options.monthlyCharBudget ?? null))
    ) {
      if (!this.budgetNotified) {
        this.budgetNotified = true;
        this.options.onBudgetExceeded?.();
      }
      return { text, outcome: "budget" };
    }
    // 5. 熔断与负缓存（4.2.2；1.6（C3）负缓存键同步 masked——失败路径同模板只失败一次）
    if (this.isCircuitOpen()) return { text, outcome: "circuit" };
    if (!opts?.bypassNegativeCache) {
      const neg = this.negativeCache.get(masked);
      if (neg !== undefined && this.now() - neg < NEGATIVE_TTL_MS) {
        return { text, outcome: "negative-cache" };
      }
    }
    // 6. 调 Provider：1.6（C3）masked 直接送译——显式占位符与数字已在 maskAll 统一 token 化
    //    （protectPlaceholders 退役；批量协议行内不再有裸数字，杜绝模型改写行内数字错位）
    try {
      const context = `${ctx.source}:${ctx.pluginId}`; // D7：仅 prompt 参考，不进缓存键
      // 1.6（F）：成本审计日志（默认关）——console.log 级别（devtools 默认可见），纯本地
      if (this.options.isCostAuditLog?.()) {
        console.log("[UUT]", ctx.source, ctx.pluginId, masked.length, masked.slice(0, 60));
      }
      const raw = this.options.translateVia
        ? await this.options.translateVia(masked, context)
        : await provider.translate(masked, { context });
      // 1.6（C2）：还原校验（token 编号集合一致 + 数字值包含安全网）——违例 = 模型吞/幻觉
      // token：丢弃译文、回退原文、不写缓存（残缺译文落盘会永久化）。
      // 复审 #1：违例进 noteFailure（负缓存按 masked 键 5 分钟抑制同模板重付 + 计入熔断——
      // 持续产残缺译文属质量故障，参数型引擎无 prompt 保护时这是唯一钱包护栏，设计 §8"负缓存兜底"）
      const restored = FilterEngine.validateAndRestore(raw.trim(), spans, numericValues);
      if (restored === null) {
        this.noteFailure(masked);
        return { text, outcome: "failed", error: t("common.placeholder-rewritten") };
      }
      // 按送译字符计量（4.5 用量统计；异步落盘失败不影响主流程）；v1.1.9：译文长度作输出字符
      // （1.6 起送译的正是 masked，输入计量口径随之更真实）
      void this.options.usageTracker?.record(masked.length, restored.length);
      // 显式占位符既有校验并行保留（1.6 C2：与还原校验叠加双保险；违例同样进 noteFailure）
      if (!FilterEngine.placeholdersIntact(text, restored)) {
        // 占位符被改写：丢弃译文、回退原文、不写缓存
        this.noteFailure(masked);
        return { text, outcome: "failed", error: t("common.placeholder-rewritten") };
      }
      if (cacheOn) {
        this.cache.set(key, {
          src: text,
          // 1.6（C3）：tgt 存 masked 态译文（未还原）——同模板不同数字命中后按当前 spans 还原
          tgt: raw.trim(),
          provider: provider.id,
          lang: this.options.targetLang,
          // v1.1.9：缓存键已含模型维度，条目冗余一份供「清理失效条目」按模型判定
          model,
          hits: 0,
          updatedAt: this.now(),
        });
      }
      this.consecutiveFailures = 0;
      return { text: restored, outcome: "translated" };
    } catch (e) {
      // 4.2.2 错误分类：Key 失效（401/403）立即提示一次，区别于普通失败的熔断计数
      if (/HTTP 40[13]/.test(String(e)) && !this.authNotified) {
        this.authNotified = true;
        this.options.onAuthFailure?.();
      }
      // R-33：失败原因上 Console（每段连续失败只记前 3 条，避免大批量刷屏）
      if (this.consecutiveFailures < 3) {
        console.warn(t("common.log-translate-failed", { n: String(e).slice(0, 160) }));
      }
      this.noteFailure(masked, e); // 1.6（C3）：负缓存键同步 masked
      return { text, outcome: "failed", error: String(e).slice(0, 160) };
    }
  }

  isCircuitOpen(): boolean {
    return this.now() < this.circuitOpenUntil;
  }

  /** v1.2 A3：熔断剩余毫秒（状态栏倒计时显示用） */
  circuitRemainingMs(): number {
    return Math.max(0, this.circuitOpenUntil - this.now());
  }

  /** 配置变更热生效（v1.1.0）：清熔断、负缓存与鉴权提示状态——修好配置后无需重启/苦等 10 分钟 */
  resetFailures(): void {
    this.circuitOpenUntil = 0;
    this.consecutiveFailures = 0;
    this.negativeCache.clear();
    this.authNotified = false;
    this.budgetNotified = false;
  }

  private noteFailure(text: string, e?: unknown): void {
    this.negativeCache.set(text, this.now());
    // v1.2 A3：429 是限流背压不是服务故障——不计入熔断连续失败
    // （负缓存照记：该文本 5 分钟内不重发，给服务商喘息；成功一次即复位连续计数）
    if (e !== undefined && /HTTP 429/.test(String(e))) return;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && !this.isCircuitOpen()) {
      this.circuitOpenUntil = this.now() + CIRCUIT_OPEN_MS;
      this.consecutiveFailures = 0;
      this.onCircuitOpen?.();
    }
  }
}

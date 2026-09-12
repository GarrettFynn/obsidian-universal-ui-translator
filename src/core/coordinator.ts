import { CacheManager } from "./cache-manager";
import { FilterEngine } from "../filters/filter-engine";
import { TranslationProvider } from "../providers/base-provider";
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
  /** 来源维度解析：pluginId → "pluginId@version" / 核心为 "core@appVersion"（装配层注入） */
  resolveFrom?: (pluginId: string) => string;
  /** 批量通道（4.2.2 BatchTranslator，装配层注入）；缺省时逐条直调 provider.translate */
  translateVia?: (masked: string, context?: string) => Promise<string>;
  /** 用量统计（4.5，装配层注入 UsageTracker）；缺省时不计量 */
  usageTracker?: {
    record(chars: number): Promise<void>;
    isOverBudget(budget: number | null): Promise<boolean>;
  };
  /** 月度字符预算（4.5）；null/缺省为不限 */
  monthlyCharBudget?: number | null;
  /** Key 失效（401/403）提示回调（4.2.2 错误分类；一次会话只提示一次） */
  onAuthFailure?: () => void;
  /** 缓存总开关（4.4 cacheEnabled，v1.1.5 接线——此前为死配置）；缺省视为开启 */
  isCacheEnabled?: () => boolean;
  /** v1.1.8：月度预算超限提示回调（4.5 承诺的"超限提示"此前未实现；一次会话只提示一次） */
  onBudgetExceeded?: () => void;
}

/**
 * 翻译请求统一入口（设计文档 3.2 数据流、3.3 模块清单）
 * 编排：FilterEngine → Glossary → CacheManager → Provider → 占位符校验 → 写缓存
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
   */
  async translateWithOutcome(
    text: string,
    ctx: TranslateContext,
    opts?: { bypassNegativeCache?: boolean }
  ): Promise<TranslateResult> {
    // 1. 过滤链（4.2.1）
    if (!this.filter.shouldTranslate(text)) return { text, outcome: "filtered" };
    // 2. 术语表前置（FR-15）
    const fixed = this.options.glossary[text];
    if (fixed) return { text: fixed, outcome: "glossary" };
    // 3. Provider 未配置：回退原文（4.4.2 未配置行为）
    const provider = this.getProvider();
    if (!provider) return { text, outcome: "no-provider" };
    // 4. 缓存（键含 providerId + targetLang + model 维度，4.2.3；v1.1.5 cacheEnabled 接线）
    const cacheOn = this.options.isCacheEnabled?.() ?? true;
    const model = this.options.getModelId?.() ?? "";
    const from = this.options.resolveFrom?.(ctx.pluginId) ?? "";
    const key = CacheManager.makeKey(text, provider.id, this.options.targetLang, model);
    const hit = cacheOn ? this.cache.get(key, from || undefined) : null;
    if (hit) return { text: hit.tgt, outcome: "cache" };
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
    // 5. 熔断与负缓存（4.2.2）
    if (this.isCircuitOpen()) return { text, outcome: "circuit" };
    if (!opts?.bypassNegativeCache) {
      const neg = this.negativeCache.get(text);
      if (neg !== undefined && this.now() - neg < NEGATIVE_TTL_MS) {
        return { text, outcome: "negative-cache" };
      }
    }
    // 6. 调 Provider：占位符 token 化保护 → 翻译 → 还原 → 校验闭环（4.2.1 规则 6）
    try {
      const { masked, tokens } = FilterEngine.protectPlaceholders(text);
      const context = `${ctx.source}:${ctx.pluginId}`; // D7：仅 prompt 参考，不进缓存键
      const raw = this.options.translateVia
        ? await this.options.translateVia(masked, context)
        : await provider.translate(masked, { context });
      // 按送译字符计量（4.5 用量统计；异步落盘失败不影响主流程）
      void this.options.usageTracker?.record(masked.length);
      const restored = FilterEngine.restorePlaceholders(raw.trim(), tokens);
      if (!FilterEngine.placeholdersIntact(text, restored)) {
        // 占位符被改写：丢弃译文、回退原文、不写缓存
        return { text, outcome: "failed", error: "译文占位符被改写" };
      }
      if (cacheOn) {
        this.cache.set(key, {
          src: text,
          tgt: restored,
          provider: provider.id,
          lang: this.options.targetLang,
          from,
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
        console.warn(`[uut] 翻译请求失败：${String(e).slice(0, 160)}`);
      }
      this.noteFailure(text);
      return { text, outcome: "failed", error: String(e).slice(0, 160) };
    }
  }

  isCircuitOpen(): boolean {
    return this.now() < this.circuitOpenUntil;
  }

  /** 配置变更热生效（v1.1.0）：清熔断、负缓存与鉴权提示状态——修好配置后无需重启/苦等 10 分钟 */
  resetFailures(): void {
    this.circuitOpenUntil = 0;
    this.consecutiveFailures = 0;
    this.negativeCache.clear();
    this.authNotified = false;
    this.budgetNotified = false;
  }

  private noteFailure(text: string): void {
    this.negativeCache.set(text, this.now());
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && !this.isCircuitOpen()) {
      this.circuitOpenUntil = this.now() + CIRCUIT_OPEN_MS;
      this.consecutiveFailures = 0;
      this.onCircuitOpen?.();
    }
  }
}

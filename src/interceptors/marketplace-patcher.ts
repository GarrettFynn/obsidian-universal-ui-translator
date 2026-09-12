import { Notice } from "obsidian";
import { TranslationCoordinator } from "../core/coordinator";
import type { TranslateOutcome } from "../core/coordinator";

type FormatFn = (translated: string, original: string) => string | null;

/**
 * 社区插件市场条目级「译」按钮（v1.1.0，用户冒烟反馈：市场体量大，按需翻译省 tokens）
 * - 观察主 document 与设置弹窗 document（与 DOMPatcher 同来源），发现市场条目即注入按钮
 * - v1.1.5：右侧详情面板（插件 README 全文——绝大多数待读英文内容所在）同样注入「译」按钮
 * - 点击只翻译该容器子树文本，正常走缓存与术语表——重复点击零成本
 * - 按钮自身 data-no-translate，不被自家通道拾取；deactivate 移除全部按钮并断开观察
 * - 条目选择器 .community-item（社区浏览器）；选择器失配时仅 debug 日志，不影响其他通道
 * - v1.1.5 嵌套乱码修复：回写后 ① 经 onWriteBack 登记到 DOMPatcher 去重账本
 *   （跨通道回写不再被当成新内容重送）；② 已译节点父元素打 data-uut="mkt" 标记，
 *   DOMPatcher 白名单与 translateItem 遍历均跳过——同一条目重复点击零送译
 * - v1.1.8 失效感知修复（用户实测"点击无反应"）：
 *   ① 结果分类（translateWithOutcome）区分"无待译"与"失败"——失败不再静默显示 ✓；
 *   ② 回写前 isConnected 存活检查（设计文档 5.2，此前漏实现——详情区频繁重渲染时
 *   译文会写到游离节点上不可见）；有游离节点且根容器仍存活时自动重试一次（译文已入缓存，零成本）；
 *   ③ 手动点击绕过 5 分钟负缓存（显式重试意图）；④ 失败时按钮 × + Notice 说明具体原因；
 *   ⑤ 已译标记改为"父元素全部送译子节点均成功"的延迟判定——同父兄弟部分失败时不再永久锁死；
 *   ⑥「临时显示原文」模式下点击明确提示（译文进缓存但不回写），不再伪装 ✓
 */
export class MarketplacePatcher {
  private observers: MutationObserver[] = [];
  private documents = new Set<Document>();
  private rescanInterval: number | null = null;
  /** v1.1.8：失败 Notice 去抖（同一原因 30 秒内不重复弹） */
  private noticeAt = new Map<string, number>();

  constructor(
    private coordinator: TranslationCoordinator,
    private format: FormatFn,
    private debug: (msg: string) => void = () => {},
    private app?: unknown,
    /** v1.1.5：回写登记回调（装配层转发到 DOMPatcher.markWrittenBack；domPatcher 后建故闭包求值） */
    private onWriteBack?: (node: Text) => void,
    /** v1.1.8：失败提示出口（默认 Obsidian Notice；测试注入收集器） */
    private notify: (msg: string) => void = (msg) => new Notice(msg)
  ) {}

  activate(): boolean {
    if (typeof MutationObserver !== "function" || !document.body) return false;
    this.rescanDocuments();
    // 市场列表异步加载/滚动增量渲染，低频轮询兜底晚到的 document 与条目
    this.rescanInterval = window.setInterval(() => this.rescanDocuments(), 3000);
    this.debug("MarketplacePatcher 已激活");
    return true;
  }

  deactivate(): void {
    for (const obs of this.observers) obs.disconnect();
    this.observers = [];
    if (this.rescanInterval !== null) {
      window.clearInterval(this.rescanInterval);
      this.rescanInterval = null;
    }
    for (const doc of this.documents) {
      doc.querySelectorAll(".uut-mkt-btn, .uut-mkt-detail-btn").forEach((b) => b.remove());
      // v1.1.5：只清本通道打的 mkt 标记（[data-uut] 另有状态栏等其他用途）
      doc.querySelectorAll('[data-uut="mkt"]').forEach((el) => el.removeAttribute("data-uut"));
    }
    this.documents.clear();
    this.noticeAt.clear();
  }

  /** v1.1.1：纳管 window.open 弹出的独立窗口 document（社区市场浏览器在其中渲染条目；幂等） */
  adoptDocument(doc: Document): void {
    if (!doc.body || this.documents.has(doc)) return;
    this.observeDocument(doc);
    this.injectButtons(doc);
  }

  private rescanDocuments(): void {
    const docs = new Set<Document>([document]);
    const modalEl = (
      this.app as { setting?: { modalEl?: HTMLElement } } | undefined
    )?.setting?.modalEl;
    if (modalEl?.ownerDocument) docs.add(modalEl.ownerDocument);
    for (const doc of docs) {
      this.observeDocument(doc);
      this.injectButtons(doc);
    }
  }

  private observeDocument(doc: Document): void {
    if (!doc.body || this.documents.has(doc)) return;
    this.documents.add(doc);
    const obs = new MutationObserver(() => this.injectButtons(doc));
    obs.observe(doc.body, { childList: true, subtree: true });
    this.observers.push(obs);
    this.debug("MarketplacePatcher 纳管新 document");
  }

  /** 为未注入的市场条目追加「译」按钮（幂等：已有按钮的条目跳过）；同时处理右侧详情面板 */
  private injectButtons(doc: Document): void {
    const items = doc.querySelectorAll(".community-item");
    let added = 0;
    items.forEach((item) => {
      // O(1) 快速路径：按钮由本通道 appendChild 在末尾——全量 7500+ 条目 × 高频突变下
      // 避免逐条 querySelector（滚动与详情重渲染期间每次突变都会触发本扫描）
      const last = item.lastElementChild;
      if (last?.classList.contains("uut-mkt-btn")) return;
      if (item.querySelector(":scope > .uut-mkt-btn")) return; // 兜底：按钮之后被追加其他元素
      const btn = doc.createElement("button");
      btn.className = "uut-mkt-btn";
      btn.textContent = "译";
      btn.setAttribute("data-no-translate", "true");
      btn.setAttribute("title", "翻译此插件条目");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.translateItem(item as HTMLElement, btn);
      });
      item.appendChild(btn);
      added++;
    });
    if (this.injectDetailButton(doc)) added++;
    if (added > 0) this.debug(`MarketplacePatcher 注入 ${added} 个按钮`);
  }

  /**
   * v1.1.5 详情面板「译」按钮：绝大多数待读英文内容是插件的完整介绍（README），在右侧详情区。
   * 结构判定（不赌详情面板内部类名）：.mod-community-plugin 弹窗的 .modal-content 内，
   * 非 .modal-sidebar 且有实质文本的容器即详情区；未选中插件（空态）时不注入。
   * 详情内容随选中插件重渲染，按钮被冲掉后由 MutationObserver 触发重注入（幂等）。
   * v1.1.6：按钮仍挂在此处，但点击的翻译根提升为整个 .mod-community-plugin 弹窗
   * （排除 .modal-sidebar 列表）——详情区实为多个并列兄弟容器，宿主容器只罩得住简介头部
   */
  private injectDetailButton(doc: Document): boolean {
    const content = doc.querySelector(".mod-community-plugin .modal-content");
    if (!content) return false;
    // 跨 realm 防御（R-30：弹窗为独立 window，instanceof 主窗口构造器必为 false）——
    // children 必为 Element，直接 duck-typing 用 classList/textContent
    const detail = Array.from(content.children).find(
      (el): el is HTMLElement =>
        !(el as HTMLElement).classList?.contains("modal-sidebar") &&
        (el.textContent?.trim().length ?? 0) > 20
    ) as HTMLElement | undefined;
    if (!detail) return false;
    // O(1) 快速路径：按钮由本通道 insertBefore 在首位；querySelector 仅作兜底
    const first = detail.firstElementChild;
    if (first?.classList.contains("uut-mkt-detail-btn")) return false;
    if (detail.querySelector(":scope > .uut-mkt-detail-btn")) return false;
    const btn = doc.createElement("button");
    btn.className = "uut-mkt-detail-btn";
    btn.textContent = "译";
    btn.setAttribute("data-no-translate", "true");
    btn.setAttribute("title", "翻译此插件的详细介绍（README 全文）；中文界面文本自动跳过、零消耗");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // v1.1.6：翻译根提升为整个市场弹窗、排除左侧列表——1.13.7 详情区是多个并列兄弟容器
      // （简介头部与 README 正文分属不同子树），v1.1.5 以宿主容器为根只翻译了简短预览
      const modal = detail.closest(".mod-community-plugin") as HTMLElement | null;
      void this.translateItem(modal ?? detail, btn, ".modal-sidebar");
    });
    detail.insertBefore(btn, detail.firstChild);
    return true;
  }

  /**
   * 点击翻译容器（条目 / 详情弹窗）：遍历子树文本节点并行送译并写回
   * （缓存命中时零 API 成本；已译节点跳过；code/pre 内代码不译——翻译会破坏代码）
   * 并行提交：批量通道按窗口聚合成批，避免长 README 逐节点串行等待数分钟
   * v1.1.8：done===0 且本轮有节点因重渲染游离 → 自动重试一次（译文已缓存，零成本秒出）
   * @param skipClosest v1.1.6：额外排除的子树选择器（详情弹窗传 ".modal-sidebar" 跳过左侧列表）
   */
  private async translateItem(
    item: HTMLElement,
    btn: HTMLButtonElement,
    skipClosest?: string
  ): Promise<void> {
    btn.textContent = "…";
    btn.setAttribute("disabled", "true");
    try {
      const stats = await this.translatePass(item, skipClosest);
      // 自动补救：存在游离节点（翻译途中详情区被重渲染）且根容器仍存活 → 重跑一次：
      // 重生节点带着原文出现，译文已进缓存，本次为零成本回写（部分游离同样补救——
      // 否则用户看到中英夹杂需要再点一次）
      if (stats.detached > 0 && item.isConnected) {
        const retry = await this.translatePass(item, skipClosest);
        stats.done += retry.done;
        stats.modeSuppressed += retry.modeSuppressed;
        stats.outcomes.push(...retry.outcomes);
        stats.firstError ??= retry.firstError;
        stats.detached = retry.detached; // 反馈以最后一趟为准
      }
      if (stats.done > 0) {
        btn.textContent = `✓${stats.done}`;
      } else {
        const blocked = this.summarizeBlocked(stats.outcomes, stats.firstError);
        if (blocked) {
          // 有待译节点但被阻断/失败：诚实显示失败并说明原因（此前静默显示 ✓，用户感知为"功能失效"）
          btn.textContent = "×";
          btn.classList.add("uut-mkt-btn-failed");
          this.notifyThrottled(blocked.key, blocked.message);
          window.setTimeout(() => {
            btn.textContent = "译";
            btn.classList.remove("uut-mkt-btn-failed");
          }, 3000);
        } else if (stats.modeSuppressed > 0) {
          // 「临时显示原文」模式：翻译成功进缓存但按模式不回写——不说清会被当成"按钮失效"
          btn.textContent = "译";
          this.notifyThrottled(
            "display-mode",
            "UUT：当前处于「临时显示原文」模式——译文已进缓存但不回写界面；执行命令「临时显示原文/恢复译文」恢复"
          );
        } else if (stats.detached > 0) {
          // 重试一趟仍全部游离：详情区持续重渲染中，译文已缓存——保持可再点的中性态
          btn.textContent = "译";
        } else {
          btn.textContent = "✓"; // 无可译节点（已译过 / 全被过滤）
        }
      }
    } catch (e) {
      // 异常兜底：恢复按钮可点状态（此前会永久卡在「…」）
      console.warn(`[uut] 市场「译」按钮翻译异常：${String(e).slice(0, 160)}`);
      btn.textContent = "译";
    } finally {
      btn.removeAttribute("disabled");
    }
  }

  /** 单趟收集 + 并行送译 + 回写；返回分类统计供调用方决定反馈与是否重试 */
  private async translatePass(
    item: HTMLElement,
    skipClosest?: string
  ): Promise<{
    done: number;
    detached: number;
    /** 「临时显示原文」模式抑制数：翻译成功（进缓存）但 format 按模式不回写 */
    modeSuppressed: number;
    outcomes: TranslateOutcome[];
    firstError?: string;
  }> {
    const doc = item.ownerDocument;
    const skipSelector =
      "[data-no-translate], [data-uut], code, pre" + (skipClosest ? `, ${skipClosest}` : "");
    const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
      acceptNode: (n: Node) =>
        // 跳过按钮自身（data-no-translate）、已译节点（data-uut 标记）、代码块与排除子树
        n.parentElement?.closest(skipSelector)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = [];
    let cur = walker.nextNode();
    while (cur) {
      nodes.push(cur as Text);
      cur = walker.nextNode();
    }
    let done = 0;
    let detached = 0;
    let modeSuppressed = 0;
    const outcomes: TranslateOutcome[] = [];
    let firstError: string | undefined;
    // v1.1.8 锁定修复：已译标记不再回写即打——按"父元素的全部送译子节点均成功"延迟判定。
    // 否则同父兄弟部分失败时父元素被打标，TreeWalker 跳过 [data-uut] 祖先，失败节点永久锁死
    const tally = new Map<Element, { total: number; ok: number }>();
    await Promise.all(
      nodes.map(async (node) => {
        const original = node.nodeValue ?? "";
        const trimmed = original.trim();
        if (trimmed.length < 2) return;
        const parent = node.parentElement;
        let t: { total: number; ok: number } | null = null;
        if (parent) {
          t = tally.get(parent) ?? { total: 0, ok: 0 };
          t.total++;
          tally.set(parent, t);
        }
        // v1.1.8：手动点击 = 显式重试意图，绕过 5 分钟负缓存（熔断/预算仍强制——钱包保护不动）
        const res = await this.coordinator.translateWithOutcome(
          trimmed,
          { source: "dom", pluginId: "marketplace" },
          { bypassNegativeCache: true }
        );
        outcomes.push(res.outcome);
        if (res.outcome === "failed") {
          firstError ??= res.error;
          return; // 不计 ok：父元素不打标，下次点击可重试
        }
        const formatted = this.format(res.text, trimmed);
        if (formatted === null || formatted === trimmed) {
          if (formatted === null && res.text !== trimmed) {
            // 「临时显示原文」模式：译文已缓存但不回写；不计 ok——恢复显示后点击应能回写
            modeSuppressed++;
          } else if (t) {
            t.ok++; // 译文即原文（过滤/缓存同文）：无需重试，计完成
          }
          return;
        }
        // 5.2 回写前存活检查（v1.1.8 补齐，此前漏实现）：详情区重渲染后节点游离，
        // 译文已入缓存，放弃回写（由调用方视情况自动重试）；不计 ok
        if (!node.isConnected) {
          detached++;
          return;
        }
        node.nodeValue = original.replace(trimmed, formatted);
        // v1.1.5 嵌套乱码修复：登记回写（DOMPatcher 不再重送）
        this.onWriteBack?.(node);
        if (t) t.ok++;
        done++;
      })
    );
    // 延迟打标：仅当父元素的全部送译子节点均成功（且未游离、非根容器自身）
    for (const [parent, t] of tally) {
      if (t.ok === t.total && parent !== item && parent.isConnected) {
        parent.setAttribute("data-uut", "mkt");
      }
    }
    return { done, detached, modeSuppressed, outcomes, firstError };
  }

  /** 有待译节点但零回写时的主因归类（按钱包安全优先级）；无可译内容返回 null（显示 ✓） */
  private summarizeBlocked(
    outcomes: TranslateOutcome[],
    firstError?: string
  ): { key: string; message: string } | null {
    if (outcomes.length === 0) return null;
    const has = (o: TranslateOutcome) => outcomes.includes(o);
    if (has("budget")) {
      return {
        key: "budget",
        message: "UUT：本月字符预算已用完，翻译已暂停（设置页 → API 配置可调整预算）",
      };
    }
    if (has("circuit")) {
      return {
        key: "circuit",
        message:
          "UUT：翻译服务连续失败、熔断保护中（约 10 分钟自动恢复）；到设置页保存一次配置可立即重置",
      };
    }
    if (has("no-provider")) {
      return { key: "no-provider", message: "UUT：未配置翻译引擎或 API Key，请到设置页完成配置" };
    }
    if (has("failed")) {
      return {
        key: "failed",
        message: `UUT：翻译请求失败（${firstError ?? "未知错误"}），已自动跳过；可稍后重试`,
      };
    }
    if (has("negative-cache")) {
      return { key: "negative-cache", message: "UUT：该文本刚刚失败过，5 分钟内不再自动重试" };
    }
    return null;
  }

  /** 失败 Notice 去抖：同一原因 30 秒内只弹一次（连点不刷屏） */
  private notifyThrottled(key: string, message: string): void {
    const now = Date.now();
    const last = this.noticeAt.get(key) ?? 0;
    if (now - last < 30_000) return;
    this.noticeAt.set(key, now);
    this.notify(message);
  }
}

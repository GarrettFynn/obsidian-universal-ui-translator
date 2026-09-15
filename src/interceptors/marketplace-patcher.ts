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
  /** v1.2 P1 二级：每文档在途翻译趟注册表与悬浮进度条（聚合显示 settled/total） */
  private activeProgress = new Map<Document, Set<{ settled: number; total: number }>>();
  private progressEls = new Map<
    Document,
    { root: HTMLElement; label: HTMLElement; fill: HTMLElement }
  >();
  private progressTimers = new Map<Document, number>();
  /** v1.3.1：弹窗常驻用量徽标（市场浏览器为独立窗口，主窗口状态栏不可见——唯一消耗视图） */
  private usageEls = new Map<Document, HTMLElement>();

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
      doc
        .querySelectorAll(".uut-mkt-btn, .uut-mkt-detail-btn, .uut-mkt-progress, .uut-mkt-usage")
        .forEach((b) => b.remove());
      // v1.1.5：只清本通道打的 mkt 标记（[data-uut] 另有状态栏等其他用途）
      doc.querySelectorAll('[data-uut="mkt"]').forEach((el) => el.removeAttribute("data-uut"));
    }
    // v1.2 P1：进度条计时器与注册表清空（弹窗窗口的计时器须经其 defaultView 清除）
    for (const [doc, timer] of this.progressTimers) {
      (doc.defaultView ?? window).clearTimeout(timer);
    }
    this.progressTimers.clear();
    this.progressEls.clear();
    this.activeProgress.clear();
    this.usageEls.clear();
    this.documents.clear();
    this.noticeAt.clear();
  }

  /** v1.1.1：纳管 window.open 弹出的独立窗口 document（社区市场浏览器在其中渲染条目；幂等） */
  adoptDocument(doc: Document): void {
    if (!doc.body || this.documents.has(doc)) return;
    this.observeDocument(doc);
    this.injectButtons(doc);
    // v1.3.1：弹窗创建常驻用量徽标（主文档不创建——主窗口已有状态栏承担）
    this.ensureUsageBadge(doc);
  }

  /**
   * v1.3.1：更新全部弹窗徽标的用量文案（供 main.ts 1Hz 供数调用）
   * text 为 null 时隐藏（设置关闭/引擎未配置等）
   */
  setUsageLine(text: string | null): void {
    for (const [doc, el] of this.usageEls) {
      if (!el.isConnected) {
        this.usageEls.delete(doc);
        continue;
      }
      el.textContent = text ?? "";
      el.classList.toggle("uut-hidden", text === null);
    }
  }

  /** v1.3.1：确保弹窗存在常驻用量徽标（R-30 跨 realm：由目标 doc 自建） */
  private ensureUsageBadge(doc: Document): void {
    if (this.usageEls.has(doc)) return;
    const el = doc.createElement("div");
    el.className = "uut-mkt-usage";
    el.setAttribute("data-uut", "usage");
    el.setAttribute("data-no-translate", "true");
    el.classList.add("uut-hidden"); // 有数据时由 setUsageLine 显示
    doc.body.appendChild(el);
    this.usageEls.set(doc, el);
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
    );
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
      const modal = detail.closest<HTMLElement>(".mod-community-plugin");
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
    btn.classList.add("uut-mkt-progressing");
    try {
      // v1.2 P1 一级：按钮内确定型进度（开译即知总量——translatePass 先收集后送译）
      const stats = await this.translatePass(item, skipClosest, (settled, total) => {
        if (btn.isConnected && total > 0) btn.textContent = `${settled}/${total}`;
      });
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
      btn.classList.remove("uut-mkt-progressing");
    }
  }

  /**
   * 单趟收集 + 并行送译 + 回写；返回分类统计供调用方决定反馈与是否重试
   * v1.2 P1：可选 onSettle 进度回调——分母为送译节点总数（先收集后送译，开译即知），
   * 分子在每个节点任意结局（成功/失败/游离/模式抑制）结算时递增，确定型不回退
   */
  private async translatePass(
    item: HTMLElement,
    skipClosest?: string,
    onSettle?: (settled: number, total: number) => void
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
    // P1：先过滤出送译目标（与下方 <2 拒译同口径）——总量开译即知，支撑确定型进度
    const targets = nodes.filter((n) => (n.nodeValue ?? "").trim().length >= 2);
    const total = targets.length;
    let settled = 0;
    // P1 二级：注册到悬浮进度条（总量为 0 不注册——避免无意义闪烁）
    const progress = total > 0 ? this.beginProgress(doc, total) : null;
    if (progress) this.renderProgress(doc);
    onSettle?.(0, total);
    let done = 0;
    let detached = 0;
    let modeSuppressed = 0;
    const outcomes: TranslateOutcome[] = [];
    let firstError: string | undefined;
    // v1.1.8 锁定修复：已译标记不再回写即打——按"父元素的全部送译子节点均成功"延迟判定。
    // 否则同父兄弟部分失败时父元素被打标，TreeWalker 跳过 [data-uut] 祖先，失败节点永久锁死
    const tally = new Map<Element, { total: number; ok: number }>();
    await Promise.all(
      targets.map(async (node) => {
        const original = node.nodeValue ?? "";
        const trimmed = original.trim();
        try {
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
        } finally {
          // P1：任意结局都结算一次（失败/游离同样推进进度；成败终态由按钮结果分支反馈）
          settled++;
          if (progress) {
            progress.settled = settled;
            this.renderProgress(doc);
          }
          onSettle?.(settled, total);
        }
      })
    );
    // 延迟打标：仅当父元素的全部送译子节点均成功（且未游离、非根容器自身）
    for (const [parent, t] of tally) {
      if (t.ok === t.total && parent !== item && parent.isConnected) {
        parent.setAttribute("data-uut", "mkt");
      }
    }
    this.endProgress(doc, progress, done);
    return { done, detached, modeSuppressed, outcomes, firstError };
  }

  /** P1 二级：注册一趟在途翻译（取消该文档待移除计时器，复用已有浮条） */
  private beginProgress(doc: Document, total: number): { settled: number; total: number } {
    let set = this.activeProgress.get(doc);
    if (!set) {
      set = new Set();
      this.activeProgress.set(doc, set);
    } else if (set.size > 0 && [...set].every((r) => r.settled >= r.total)) {
      // 上一轮已全部完成（浮条待移除）→ 开新会话，聚合口径回到本轮
      set.clear();
    }
    const record = { settled: 0, total };
    set.add(record);
    const timer = this.progressTimers.get(doc);
    if (timer !== undefined) {
      (doc.defaultView ?? window).clearTimeout(timer);
      this.progressTimers.delete(doc);
    }
    return record;
  }

  /** P1 二级：按注册表聚合刷新浮条文本与十档宽度（离散类切换，禁内联样式） */
  private renderProgress(doc: Document): void {
    const set = this.activeProgress.get(doc);
    if (!set || set.size === 0) return;
    let settled = 0;
    let total = 0;
    for (const r of set) {
      settled += r.settled;
      total += r.total;
    }
    const el = this.ensureProgressEl(doc);
    el.label.textContent = `UUT 翻译中 ${settled}/${total}`;
    const step = total === 0 ? 0 : Math.min(10, Math.floor((settled / total) * 10));
    // v1.3 F2：批在途（有未结算节点）时填充条脉动——消除"计数冻结不动"的静止感
    const pulse = settled < total ? " uut-pulse" : "";
    el.fill.className = `uut-mkt-progress-fill uut-p-${step}${pulse}`;
  }

  /** P1 二级：一趟结束——保留在注册表（累计口径：完成的趟仍计入 settled/total）；
   * 该文档全部趟完成时显示完成并延时移除浮条 */
  private endProgress(
    doc: Document,
    record: { settled: number; total: number } | null,
    done: number
  ): void {
    if (!record) return;
    const set = this.activeProgress.get(doc);
    if (!set) return;
    const allDone = [...set].every((r) => r.settled >= r.total);
    if (!allDone) {
      this.renderProgress(doc);
      return;
    }
    this.activeProgress.delete(doc);
    const el = this.progressEls.get(doc);
    if (el?.root.isConnected) {
      el.label.textContent = done > 0 ? "UUT ✓ 已完成" : "UUT 已结束";
      // v1.3 F1：完成态立即淡出（原停留 1.5s 造成"进度条比译文慢一秒"的观感）
      el.root.classList.add("uut-mkt-progress-done");
    }
    const view = doc.defaultView ?? window;
    this.progressTimers.set(
      doc,
      view.setTimeout(() => {
        this.progressEls.get(doc)?.root.remove();
        this.progressEls.delete(doc);
        this.progressTimers.delete(doc);
      }, 600)
    );
  }

  /** P1 二级：确保该文档存在悬浮进度条元素（R-30 跨 realm：元素由目标 doc 自建） */
  private ensureProgressEl(doc: Document): {
    root: HTMLElement;
    label: HTMLElement;
    fill: HTMLElement;
  } {
    const existing = this.progressEls.get(doc);
    if (existing?.root.isConnected) return existing;
    const root = doc.createElement("div");
    root.className = "uut-mkt-progress";
    root.setAttribute("data-uut", "progress");
    root.setAttribute("data-no-translate", "true");
    const track = doc.createElement("div");
    track.className = "uut-mkt-progress-track";
    const fill = doc.createElement("div");
    fill.className = "uut-mkt-progress-fill uut-p-0";
    track.appendChild(fill);
    const label = doc.createElement("span");
    root.appendChild(track);
    root.appendChild(label);
    doc.body.appendChild(root);
    const el = { root, label, fill };
    this.progressEls.set(doc, el);
    return el;
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

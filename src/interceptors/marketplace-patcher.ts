import { TranslationCoordinator } from "../core/coordinator";

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
 */
export class MarketplacePatcher {
  private observers: MutationObserver[] = [];
  private documents = new Set<Document>();
  private rescanInterval: number | null = null;

  constructor(
    private coordinator: TranslationCoordinator,
    private format: FormatFn,
    private debug: (msg: string) => void = () => {},
    private app?: unknown,
    /** v1.1.5：回写登记回调（装配层转发到 DOMPatcher.markWrittenBack；domPatcher 后建故闭包求值） */
    private onWriteBack?: (node: Text) => void
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
      if (item.querySelector(":scope > .uut-mkt-btn")) return;
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
      await Promise.all(
        nodes.map(async (node) => {
          const original = node.nodeValue ?? "";
          const trimmed = original.trim();
          if (trimmed.length < 2) return;
          const translated = await this.coordinator.translate(trimmed, {
            source: "dom",
            pluginId: "marketplace",
          });
          const formatted = this.format(translated, trimmed);
          if (formatted === null || formatted === trimmed) return;
          node.nodeValue = original.replace(trimmed, formatted);
          // v1.1.5 嵌套乱码修复：登记回写（DOMPatcher 不再重送）+ 打已译标记（两通道均跳过）
          this.onWriteBack?.(node);
          node.parentElement?.setAttribute("data-uut", "mkt");
          done++;
        })
      );
      btn.textContent = done > 0 ? `✓${done}` : "✓";
    } finally {
      btn.removeAttribute("disabled");
    }
  }
}

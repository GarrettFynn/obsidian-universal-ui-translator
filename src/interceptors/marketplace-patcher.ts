import { TranslationCoordinator } from "../core/coordinator";

type FormatFn = (translated: string, original: string) => string | null;

/**
 * 社区插件市场条目级「译」按钮（v1.1.0，用户冒烟反馈：市场体量大，按需翻译省 tokens）
 * - 观察主 document 与设置弹窗 document（与 DOMPatcher 同来源），发现市场条目即注入按钮
 * - 点击只翻译该条目子树文本（名称/简介/作者等），正常走缓存与术语表——重复点击零成本
 * - 按钮自身 data-no-translate，不被自家通道拾取；deactivate 移除全部按钮并断开观察
 * - 条目选择器 .community-item（社区浏览器）；选择器失配时仅 debug 日志，不影响其他通道
 */
export class MarketplacePatcher {
  private observers: MutationObserver[] = [];
  private documents = new Set<Document>();
  private rescanInterval: number | null = null;

  constructor(
    private coordinator: TranslationCoordinator,
    private format: FormatFn,
    private debug: (msg: string) => void = () => {},
    private app?: unknown
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
      doc.querySelectorAll(".uut-mkt-btn").forEach((b) => b.remove());
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

  /** 为未注入的市场条目追加「译」按钮（幂等：已有按钮的条目跳过） */
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
    if (added > 0) this.debug(`MarketplacePatcher 注入 ${added} 个条目按钮`);
  }

  /** 点击翻译单条目：遍历子树文本节点逐条送译并写回（缓存命中时零 API 成本） */
  private async translateItem(item: HTMLElement, btn: HTMLButtonElement): Promise<void> {
    btn.textContent = "…";
    btn.setAttribute("disabled", "true");
    try {
      const doc = item.ownerDocument;
      const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
        acceptNode: (n: Node) =>
          n.parentElement?.closest("[data-no-translate]")
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
      for (const node of nodes) {
        const original = node.nodeValue ?? "";
        const trimmed = original.trim();
        if (trimmed.length < 2) continue;
        const translated = await this.coordinator.translate(trimmed, {
          source: "dom",
          pluginId: "marketplace",
        });
        const formatted = this.format(translated, trimmed);
        if (formatted === null || formatted === trimmed) continue;
        node.nodeValue = original.replace(trimmed, formatted);
        done++;
      }
      btn.textContent = done > 0 ? `✓${done}` : "✓";
    } finally {
      btn.removeAttribute("disabled");
    }
  }
}

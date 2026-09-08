import { Notice } from "obsidian";
import { TranslationCoordinator } from "../core/coordinator";

type FormatFn = (translated: string, original: string) => string | null;

/**
 * 白名单（默认跳过，设计文档 4.1.4）：
 * 编辑器与代码/输入区、主动声明不翻译、阅读视图与悬浮预览/嵌入块、
 * 用户数据区域（文件管理器/大纲/标签/搜索摘录）、插件自身回写产物
 */
const SKIP_SELECTORS = [
  ".cm-content",
  ".markdown-source-view",
  "code",
  "pre",
  "input",
  "textarea",
  '[contenteditable="true"]',
  "[data-no-translate]",
  ".markdown-reading-view",
  ".hover-popover",
  ".markdown-embed",
  ".internal-embed",
  ".nav-files-container",
  '.workspace-leaf-content[data-type="outline"]',
  '.workspace-leaf-content[data-type="tag"]',
  ".search-result-file-match",
  ".workspace-tab-header-inner-title",
  ".uut-original",
  "[data-uut]",
];

/**
 * DOMPatcher（设计文档 4.1.4，全局兜底）
 * - MutationObserver：document.body，childList + subtree + characterData
 * - 用途：Notice、状态栏、Modal、命令面板渲染列表、各插件自定义视图等无法原型劫持的文本
 * - 去重即回写循环抑制：WeakMap<Node, string> 按"节点 → 上次处理文本值"去重——
 *   MutationObserver 回调是微任务，writing 标志在异步回写时已复位、不可靠；
 *   真正的抑制机制是回写后更新去重记录（新文本不再送译），writing 仅作同步辅助
 * - requestIdleCallback（超时 100ms）空闲调度；单帧预算 5ms，超出入队延后
 * - 不可见元素（checkVisibility() === false）跳过，近似非活动标签页暂停
 * - 双语模式在状态栏降级为仅译文 + 父级 tooltip（5.1 空间受限策略）
 * - D1：MutationObserver 不可用则本通道熔断；deactivate 断开 observer 并清空队列
 */
export class DOMPatcher {
  private observers: MutationObserver[] = [];
  private documents = new Set<Document>();
  private layoutEventRef: unknown = null;
  private rescanTimer: number | null = null;
  private rescanInterval: number | null = null;
  private processed = new WeakMap<Node, string>();
  /** R-32：不可见节点的延迟重试计数（防记录毒化后的无限重试；WeakMap 随节点回收） */
  private retryAttempts = new WeakMap<Node, number>();
  private writing = false;
  private queue: Text[] = [];
  private idleScheduled = false;

  constructor(
    private coordinator: TranslationCoordinator,
    private format: FormatFn,
    private isBilingual: () => boolean,
    private debug: (msg: string) => void = () => {},
    /** R-12：多 document 观察所需的 app 引用；缺省时仅观察主 document（向后兼容） */
    private app?: unknown,
    /** R-22 时序修订：低频重扫间隔 ms（设置弹窗打开不触发 layout-change）；测试可注入 */
    private rescanIntervalMs = 3000
  ) {}

  activate(): boolean {
    if (typeof MutationObserver !== "function" || !document.body) {
      new Notice("UUT：DOM 兜底通道翻译已停用（MutationObserver 不可用）");
      return false;
    }
    this.rescanDocuments();
    // R-12：布局变化（新开 popout 独立窗口等）时防抖重扫，纳管新 document
    const workspace = (
      this.app as { workspace?: { on?: (ev: string, cb: () => void) => unknown } } | undefined
    )?.workspace;
    if (workspace && typeof workspace.on === "function") {
      this.layoutEventRef = workspace.on("layout-change", () => {
        if (this.rescanTimer !== null) window.clearTimeout(this.rescanTimer);
        this.rescanTimer = window.setTimeout(() => this.rescanDocuments(), 500);
      });
    }
    // R-22/E-12 修订：设置弹窗打开不触发 layout-change——低频轮询重扫兜底晚到的窗口
    this.rescanInterval = window.setInterval(
      () => this.rescanDocuments(),
      this.rescanIntervalMs
    );
    this.debug(`DOMPatcher 已激活，观察 ${this.observers.length} 个 document`);
    return true;
  }

  deactivate(): void {
    for (const obs of this.observers) obs.disconnect();
    this.observers = [];
    this.documents.clear();
    if (this.rescanTimer !== null) {
      window.clearTimeout(this.rescanTimer);
      this.rescanTimer = null;
    }
    if (this.rescanInterval !== null) {
      window.clearInterval(this.rescanInterval);
      this.rescanInterval = null;
    }
    const workspace = (
      this.app as { workspace?: { offref?: (ref: unknown) => void } } | undefined
    )?.workspace;
    if (workspace && typeof workspace.offref === "function" && this.layoutEventRef) {
      workspace.offref(this.layoutEventRef);
    }
    this.layoutEventRef = null;
    this.queue = [];
  }

  /** R-12：收集全部 document（主窗口 + 各 leaf 的 ownerDocument，含 popout）并逐一建 observer */
  private rescanDocuments(): void {
    const docs = new Set<Document>([document]);
    // R-22：设置弹窗（Modal 型独立窗口）不经 iterateAllLeaves 可达；
    // E-11 曾选 containerEl——E-12 复验决定性证据：其为主窗口预创建壳（isConnected=false）；
    // 真实内容树挂在 modalEl 所属的弹窗 document 下（isConnected=true）
    const settingModalEl = (
      this.app as { setting?: { modalEl?: HTMLElement } } | undefined
    )?.setting?.modalEl;
    if (settingModalEl?.ownerDocument) docs.add(settingModalEl.ownerDocument);
    const workspace = (
      this.app as {
        workspace?: { iterateAllLeaves?: (cb: (leaf: unknown) => void) => void };
      } | undefined
    )?.workspace;
    workspace?.iterateAllLeaves?.((leaf) => {
      const containerEl = (leaf as { view?: { containerEl?: HTMLElement } }).view?.containerEl;
      if (containerEl?.ownerDocument) docs.add(containerEl.ownerDocument);
    });
    for (const doc of docs) this.observeDocument(doc);
  }

  /** 配置变更热生效（v1.1.0）：重置去重/重试记录，对所有已纳管 document 全量重扫——已渲染未译的界面就地重译 */
  rescanAllText(): void {
    this.processed = new WeakMap();
    this.retryAttempts = new WeakMap();
    for (const doc of this.documents) {
      if (doc.body) this.collectTextNodes(doc.body);
    }
    this.scheduleIdle();
  }

  private observeDocument(doc: Document): void {
    if (!doc.body || this.documents.has(doc)) return;
    this.documents.add(doc);
    const obs = new MutationObserver((records) => this.onMutations(records));
    obs.observe(doc.body, { childList: true, subtree: true, characterData: true });
    this.observers.push(obs);
    // R-31：非主 document（设置弹窗/popout）纳管时对存量文本初始扫描——
    // 首屏可能已渲染完毕，MutationObserver 只见增量突变；
    // 主 document 保持增量行为不变（控制启动成本与边界风险）
    if (doc !== document) {
      this.collectTextNodes(doc.body);
      this.scheduleIdle();
    }
    this.debug("DOMPatcher 纳管新 document");
  }

  private onMutations(records: MutationRecord[]): void {
    if (this.writing) return; // 同步辅助抑制；主抑制见 processNode 回写后的记录更新
    for (const record of records) {
      if (record.type === "characterData") {
        this.enqueue(record.target);
      } else {
        record.addedNodes.forEach((node) => this.collectTextNodes(node));
      }
    }
    this.scheduleIdle();
  }

  private collectTextNodes(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.enqueue(node);
      return;
    }
    // R-30：弹窗为独立 window/realm，instanceof 主窗口构造器必为 false；
    // nodeType 判定与 realm 无关（ELEMENT_NODE 为常量 1）
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (this.isSkipped(node as HTMLElement)) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let cur = walker.nextNode();
    while (cur) {
      this.enqueue(cur);
      cur = walker.nextNode();
    }
  }

  private enqueue(node: Node, fromRetry = false): void {
    const text = node.nodeValue?.trim() ?? "";
    if (text.length < 2) return;
    if (this.processed.get(node) === text) return; // 文本值未变才跳过（A3 修复口径）
    const parent = node.parentElement;
    if (!parent || this.isSkipped(parent)) return;
    this.processed.set(node, text);
    // R-32：新文本重置重试计数；重试路径（fromRetry）保留计数防无限循环
    if (!fromRetry) this.retryAttempts.set(node, 0);
    this.queue.push(node as Text);
  }

  private isSkipped(el: HTMLElement): boolean {
    for (const sel of SKIP_SELECTORS) {
      if (el.closest(sel)) return true;
    }
    return false;
  }

  private scheduleIdle(): void {
    if (this.idleScheduled) return;
    this.idleScheduled = true;
    const ric: (cb: () => void, opts?: { timeout: number }) => void =
      (
        window as unknown as {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
        }
      ).requestIdleCallback ?? ((cb) => window.setTimeout(cb, 100));
    ric(
      () => {
        this.idleScheduled = false;
        const start = performance.now();
        // 单帧预算 5ms，超出部分入队延后（4.1.4）
        while (this.queue.length > 0 && performance.now() - start < 5) {
          const node = this.queue.shift()!;
          void this.processNode(node);
        }
        if (this.queue.length > 0) this.scheduleIdle();
      },
      { timeout: 100 }
    );
  }

  private async processNode(node: Text): Promise<void> {
    const original = node.nodeValue ?? "";
    const trimmed = original.trim();
    if (trimmed.length < 2) return;
    if (!node.isConnected) return; // 5.2 存活检查（菜单已关、Notice 已消失等）
    const parent = node.parentElement;
    if (
      parent &&
      typeof parent.checkVisibility === "function" &&
      !parent.checkVisibility()
    ) {
      // R-32：不可见节点延迟重试——回滚去重记录（否则"译文未写、记录固化"= 永久 skip），
      // 1s 后重入队，至多 30 次；节点死亡或插件卸载（documents 清空）即停
      this.processed.delete(node);
      const attempts = (this.retryAttempts.get(node) ?? 0) + 1;
      this.retryAttempts.set(node, attempts);
      if (attempts <= 30) {
        window.setTimeout(() => {
          if (node.isConnected && this.documents.size > 0) {
            this.enqueue(node, true);
            this.scheduleIdle(); // R-33：重试入队后必须触发排空（enqueue 本身不调度）
          }
        }, 1000);
      }
      return;
    }
    const translated = await this.coordinator.translate(trimmed, {
      source: "dom",
      pluginId: "unknown",
    });
    if (!node.isConnected) return;
    let formatted = this.format(translated, trimmed);
    // 双语模式在状态栏降级：仅译文 + 父级 tooltip（5.1）
    if (formatted !== null && this.isBilingual() && parent?.closest(".status-bar")) {
      if (translated === trimmed) return;
      formatted = translated;
      parent.setAttr("title", trimmed);
    }
    if (formatted === null) return;
    this.writing = true;
    try {
      node.nodeValue = original.replace(trimmed, formatted); // 保留前后空白
    } finally {
      this.writing = false;
    }
    // 主回写循环抑制：更新去重记录，回写产生的新文本不再送译
    this.processed.set(node, node.nodeValue ?? "");
  }
}

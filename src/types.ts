// 公共类型契约（设计文档 4.4 配置系统、4.2.3 缓存结构）

export type DisplayMode = "replace" | "bilingual" | "original";
export type BilingualFormat = "{t} ({o})" | "{o} | {t}";

/** 拦截器来源标识（设计文档 3.2 数据流中的上下文 source） */
export type InterceptorSource = "command" | "menu" | "setting" | "dom";

export interface TranslateContext {
  source: InterceptorSource;
  pluginId: string;
}

/** 各 Provider 的差异化配置（API Key 不入此对象，见设计文档 4.4.1） */
export interface ProviderConfig {
  apiBaseUrl?: string;
  model?: string;
  region?: string;
  extraHeaders?: Record<string, string>;
  /** Custom Provider：请求体 JSON 模板 */
  requestTemplate?: string;
  /** Custom Provider：响应 JSONPath */
  responsePath?: string;
  /** OpenAI 兼容接口：请求体注入 thinking:{type:"disabled"}（DeepSeek V4 等默认开启思考的模型，R-34） */
  disableThinking?: boolean;
  /** v1.3：token 单价（每百万）——挂在自定义接入接口（openai）配置上，两者齐备且 >0 才启用费用展示 */
  pricePerMillion?: { input: number; output: number };
  /** 货币符号（原样展示，缺省 ¥） */
  priceCurrency?: string;
}

/** v1.3：单次请求 API 上报的 token 用量（OpenAI 兼容响应 usage 字段，账单口径） */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface PluginSettings {
  enabled: boolean;
  targetLang: string;
  displayMode: DisplayMode;
  bilingualFormat: BilingualFormat;
  activeProvider: string;
  providers: Record<string, ProviderConfig>;
  cacheEnabled: boolean;
  cacheMaxEntries: number;
  batchWindowMs: number;
  maxConcurrentRequests: number;
  requestTimeoutMs: number;                 // 默认 30000（R-23：慢引擎上调，4.2.2）
  /** 月度字符预算，null 为不限；超限自动暂停翻译并提示 */
  monthlyCharBudget: number | null;
  /** FR-15 术语表：原文 → 固定译文 */
  glossary: Record<string, string>;
  skipPatterns: string[];
  scope: {
    core: boolean;
    /** v1.1.5 起默认关闭：开启后社区市场浏览器可见条目会被自动翻译（滚动即持续消耗 API）；
     *  推荐改用条目「译」按钮按需翻译。控制面：社区插件命令通道 + 市场弹窗自动翻译
     *  （Setting/DOM 通道无法归因插件归属，不受此开关控制，设置页如实标注） */
    communityPlugins: boolean;
    pluginWhitelist: string[];
    pluginBlacklist: string[];
  };
  interceptors: {
    command: boolean;
    menu: boolean;
    setting: boolean;
    dom: boolean;
    /** v1.1.0 社区市场条目级「译」按钮；旧 data.json 无此键，读取处按 !== false 兜底（默认开） */
    marketplace?: boolean;
  };
  /** v1.1.5 一次性迁移标记：communityPlugins 在 <1.1.5 从未生效（死配置），旧值 true 不代表
   *  用户真实意图，升级时统一置 false 并写此标记（仅迁移一次，之后尊重用户手动选择） */
  communityScopeMigratedV115?: boolean;
  /** v1.3：状态栏用量速率段（token/字符口径 + 今日费用估算），默认开 */
  usageInStatusBar: boolean;
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  enabled: true,
  targetLang: "zh-CN",
  displayMode: "replace",
  bilingualFormat: "{t} ({o})",
  activeProvider: "openai",
  providers: {},
  cacheEnabled: true,
  cacheMaxEntries: 50000,
  batchWindowMs: 100,
  maxConcurrentRequests: 3,
  requestTimeoutMs: 30000,
  monthlyCharBudget: null,
  glossary: {},
  skipPatterns: [],
  scope: {
    core: true,
    // v1.1.5：默认关闭（此前为死配置且默认开——市场浏览器滚动即持续自动送译烧额度）
    communityPlugins: false,
    pluginWhitelist: [],
    // 默认排除本插件自身（自我翻译防护，设计文档 4.4）
    pluginBlacklist: ["universal-ui-translator"],
  },
  interceptors: { command: true, menu: true, setting: true, dom: true, marketplace: true },
  usageInStatusBar: true,
  debugMode: false,
};

/** 缓存条目与磁盘文件结构（设计文档 4.2.3） */
export interface CacheEntry {
  src: string;
  tgt: string;
  provider: string;
  lang: string;
  /** v1.1.9：模型 id 冗余（缓存键已含模型维度；供「清理失效条目」按模型判定；旧条目无此字段） */
  model?: string;
  /** v1.2 起为遗留字段（B1 来源版本维度退役）：旧条目保留原值仅供兼容读取，新写入不再赋值 */
  from?: string;
  /** v1.2（B2）：最近一次命中时间；缺省回落 updatedAt——90 天淘汰与 flush 排序统一按此口径 */
  lastAccessAt?: number;
  hits: number;
  updatedAt: number;
}

export interface CacheFile {
  schemaVersion: number;
  entries: Record<string, CacheEntry>;
}

export const CACHE_SCHEMA_VERSION = 1;

/**
 * 文本文件 IO 抽象：真实环境由 app.vault.adapter 实现（装配批次完成），
 * 单元测试用内存实现。KeyStorage 与 CacheManager 均依赖此接口。
 */
export interface TextFileIO {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

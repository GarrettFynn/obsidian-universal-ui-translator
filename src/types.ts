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
  cacheMaxEntries: 5000,
  batchWindowMs: 100,
  maxConcurrentRequests: 3,
  requestTimeoutMs: 30000,
  monthlyCharBudget: null,
  glossary: {},
  skipPatterns: [],
  scope: {
    core: true,
    communityPlugins: true,
    pluginWhitelist: [],
    // 默认排除本插件自身（自我翻译防护，设计文档 4.4）
    pluginBlacklist: ["universal-ui-translator"],
  },
  interceptors: { command: true, menu: true, setting: true, dom: true, marketplace: true },
  debugMode: false,
};

/** 缓存条目与磁盘文件结构（设计文档 4.2.3） */
export interface CacheEntry {
  src: string;
  tgt: string;
  provider: string;
  lang: string;
  /** 来源维度：pluginId@version，核心文本为 core@appVersion */
  from: string;
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

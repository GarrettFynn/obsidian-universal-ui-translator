import { KeyStorage } from "../core/key-storage";
import { PluginSettings, TokenUsage } from "../types";
import { AzureProvider } from "./azure-provider";
import { HttpClient, TranslationProvider } from "./base-provider";
import { CustomProvider } from "./custom-provider";
import { DeepLProvider } from "./deepl-provider";
import { GoogleProvider } from "./google-provider";
import { OpenAIProvider } from "./openai-provider";

/**
 * 按当前配置构建活动 Provider（设计文档 4.3.2）。
 * 缺 API Key（openai）或缺端点（custom）时返回 null——4.4.2：未配置可用 Provider 时拦截器不激活。
 * v1.3：usageSink 仅 openai 透传（响应 usage 字段为账单口径；其他引擎按字符计费不需要）。
 */
export async function createActiveProvider(
  settings: PluginSettings,
  keyStorage: KeyStorage,
  http: HttpClient,
  usageSink?: (u: TokenUsage) => void
): Promise<TranslationProvider | null> {
  const id = settings.activeProvider;
  const cfg = settings.providers[id] ?? {};
  const key = (await keyStorage.get(id)) ?? undefined;
  if (id === "openai") {
    if (!key) return null;
    return new OpenAIProvider(http, {
      apiKey: key,
      targetLang: settings.targetLang,
      baseUrl: cfg.apiBaseUrl || undefined,
      model: cfg.model || undefined,
      disableThinking: cfg.disableThinking,
      onUsage: usageSink,
    });
  }
  if (id === "custom") {
    if (!cfg.apiBaseUrl) return null;
    return new CustomProvider(http, {
      targetLang: settings.targetLang,
      endpoint: cfg.apiBaseUrl,
      requestTemplate: cfg.requestTemplate || undefined,
      responsePath: cfg.responsePath || undefined,
      model: cfg.model || undefined,
      apiKey: key,
    });
  }
  if (id === "deepl") {
    if (!key) return null;
    return new DeepLProvider(http, { apiKey: key, targetLang: settings.targetLang });
  }
  if (id === "google") {
    if (!key) return null;
    return new GoogleProvider(http, { apiKey: key, targetLang: settings.targetLang });
  }
  if (id === "azure") {
    if (!key || !cfg.region) return null;
    return new AzureProvider(http, {
      apiKey: key,
      region: cfg.region,
      targetLang: settings.targetLang,
    });
  }
  return null;
}

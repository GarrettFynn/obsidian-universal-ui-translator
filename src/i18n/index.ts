/**
 * 插件自身 UI 文案的 i18n 框架（1.4 国际化一期设计第四节）。
 * 红线：locale 文件全部本地内置（src/i18n/），禁止任何动态网络加载。
 */
import { zhCN } from "./zh-CN";
import { en } from "./en";

/** 运行时界面语言（由 settings.uiLanguage 解析得到） */
export type UiLocale = "zh-CN" | "en";

/** 设置项取值：auto 跟随 Obsidian 界面语言 */
export type UiLanguageSetting = "auto" | "zh-CN" | "en";

/** 缺省 zh-CN：保证未装配阶段（含单测）与升级用户的中文体验不变 */
let currentLocale: UiLocale = "zh-CN";

/** 切换界面语言（配置变更即调，热生效）。
 *  已知边界：命令名在 onload 注册时求值，切换后重启生效（设计 4.3）。 */
export function setUiLocale(locale: UiLocale): void {
  currentLocale = locale;
}

/**
 * settings.uiLanguage → 实际 locale：
 * 显式值直取；auto 按 Obsidian 界面语言（moment locale）前缀 zh* → zh-CN，否则 en。
 */
export function resolveUiLocale(
  uiLanguage: UiLanguageSetting,
  momentLocale: string
): UiLocale {
  if (uiLanguage === "zh-CN") return "zh-CN";
  if (uiLanguage === "en") return "en";
  return momentLocale.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/**
 * 取文案：当前 locale 映射 → zh-CN 映射 → 返回 key 本身（缺键显形）。
 * vars 做 {name} 简单插值（状态栏计数等动态片段，如 {n}/{m}）。
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = currentLocale === "en" ? en : zhCN;
  let value = dict[key] ?? zhCN[key] ?? key;
  if (vars) {
    for (const [name, v] of Object.entries(vars)) {
      value = value.split(`{${name}}`).join(String(v));
    }
  }
  return value;
}

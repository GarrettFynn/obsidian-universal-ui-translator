/**
 * 核心版本号来源（R-05 / D5 补注）：手工验证实测 `app.appVersion` 为空字符串，
 * 导致核心缓存条目 from: "core@"、Obsidian 升级后旧译无法惰性失效。
 * 解析顺序：appVersion（首选）→ navigator.userAgent 中的 obsidian/x.y.z → "unknown"。
 */
export function resolveObsidianVersion(appVersion: unknown, userAgent: string): string {
  if (typeof appVersion === "string" && appVersion.length > 0) {
    return appVersion;
  }
  const m = userAgent.match(/obsidian\/([\d.]+)/i);
  return m?.[1] ?? "unknown";
}

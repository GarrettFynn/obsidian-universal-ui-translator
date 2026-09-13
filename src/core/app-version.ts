/**
 * 核心版本号来源（R-05 / D5 补注）：手工验证实测 `app.appVersion` 可能为空字符串，
 * 导致核心缓存条目 from: "core@"、Obsidian 升级后旧译无法惰性失效。
 * v1.1.11：移除 navigator.userAgent 兜底——官方目录审查禁止任何 navigator API 引用
 * （含本处非 OS 探测用途），Platform API 不提供版本号、无合规替代。
 * 降级影响：appVersion 缺失时缓存键固定为 core@unknown，Obsidian 升级后旧译不再
 * 惰性失效，可经设置页「清空缓存」手动重建；resolveFrom 在翻译期调用（布局就绪后），
 * 正常情况下 appVersion 均有值，不受影响。
 */
export function resolveObsidianVersion(appVersion: unknown): string {
  if (typeof appVersion === "string" && appVersion.length > 0) {
    return appVersion;
  }
  return "unknown";
}

/**
 * 智能过滤（设计文档 4.2.1）
 * 规则按优先级执行，命中即决定放行或拒绝：
 * 1 用户自定义正则 → 拒绝
 * 2 纯数字 / 纯符号 / 长度 < 2 → 拒绝
 * 3 文件路径 → 拒绝
 * 4 URL / URI → 拒绝
 * 5 不含连续 2 个拉丁字母 → 拒绝
 * 5b CJK 表意字符数 ≥ 拉丁字母数 → 拒绝（R-06：已本地化混合文本，送译只返回原文）
 * 6 含占位符 → 放行，占位符 token 化保护后送译，译后校验（见静态方法组）
 * 7 默认 → 放行
 */
export class FilterEngine {
  private userPatterns: RegExp[] = [];

  constructor(skipPatterns: string[] = []) {
    this.setSkipPatterns(skipPatterns);
  }

  setSkipPatterns(patterns: string[]): void {
    this.userPatterns = [];
    for (const p of patterns) {
      try {
        this.userPatterns.push(new RegExp(p));
      } catch {
        // 非法用户正则：忽略（设置面板高级 Tab 负责提示，设计文档 4.5）
      }
    }
  }

  /** 规则 1–5、7：是否需要翻译 */
  shouldTranslate(text: string): boolean {
    const t = text.trim();
    // 规则 1：用户自定义正则
    if (this.userPatterns.some((re) => re.test(t))) return false;
    // 规则 2：长度 < 2 / 纯数字 / 纯符号
    if (t.length < 2) return false;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(t)) return false;
    // 规则 3：文件路径（盘符或斜杠开头 / 含路径分隔符 / 文件名.扩展名）
    if (/^([a-zA-Z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])/.test(t)) return false;
    if (/^[\w.-]+([\\/][\w .-]+)+$/.test(t)) return false;
    if (/^[\w-]+\.[a-zA-Z0-9]{1,5}$/.test(t)) return false;
    // 规则 4：URL / URI
    if (/^(https?|ftp|obsidian|mailto|tel):/i.test(t)) return false;
    // 规则 5：不含连续 2 个拉丁字母（已汉化文本、纯 CJK 文本不再送译）
    if (!/[A-Za-z]{2}/.test(t)) return false;
    // 规则 5b：CJK 表意字符数 ≥ 拉丁字母数（已本地化混合文本，送译只返回原文，白耗调用；R-06）
    const latinCount = (t.match(/[A-Za-z]/g) ?? []).length;
    const cjkCount = (t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
    if (cjkCount >= 2 && cjkCount >= latinCount) return false;
    // 规则 7：默认放行
    return true;
  }

  /** 规则 6：提取占位符（{0}、%s、%d、{{var}}） */
  static extractPlaceholders(text: string): string[] {
    const matches = text.match(/\{\d+\}|%[sd]|\{\{[^}]+\}\}/g);
    return matches ?? [];
  }

  /** 规则 6：占位符 token 化保护，送译 masked 而非原文 */
  static protectPlaceholders(text: string): { masked: string; tokens: string[] } {
    const tokens = FilterEngine.extractPlaceholders(text);
    let masked = text;
    tokens.forEach((token, i) => {
      masked = masked.split(token).join(`__UUTPH${i}__`);
    });
    return { masked, tokens };
  }

  /** 规则 6：翻译完成后还原占位符 */
  static restorePlaceholders(translated: string, tokens: string[]): string {
    let out = translated;
    tokens.forEach((token, i) => {
      out = out.split(`__UUTPH${i}__`).join(token);
    });
    return out;
  }

  /**
   * 规则 6 校验闭环：还原后译文与原文的占位符集合必须一致。
   * 不一致时调用方丢弃译文、回退原文，且不写入缓存（残缺译文落盘会永久化）。
   */
  static placeholdersIntact(original: string, restored: string): boolean {
    const a = FilterEngine.extractPlaceholders(original).sort().join("");
    const b = FilterEngine.extractPlaceholders(restored).sort().join("");
    return a === b;
  }
}

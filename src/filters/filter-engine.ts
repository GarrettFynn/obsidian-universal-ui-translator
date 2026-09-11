/**
 * 智能过滤（设计文档 4.2.1）
 * 规则按优先级执行，命中即决定放行或拒绝：
 * 1 用户自定义正则 → 拒绝
 * 2 纯数字 / 纯符号 / 长度 < 2 → 拒绝
 * 2b 长度 > MAX_TRANSLATABLE_CHARS（2000）→ 拒绝（v1.1.5：UI 文本不会超此长度；
 *    失控嵌套文本可达数 MB，单请求成本与缓存体积必须有硬上限）
 * 3 文件路径 → 拒绝
 * 4 URL / URI → 拒绝
 * 5 不含连续 2 个拉丁字母 → 拒绝
 * 5b CJK 表意字符数 ≥ 拉丁字母数 → 拒绝（R-06：已本地化混合文本，送译只返回原文）
 * 5c v1.1.5 嵌套乱码防线（目标语言为 zh 系时）：文本含 ≥2 个 CJK 表意字符即拒绝——
 *    UI 原文为英文，含中文说明是双语回写产物或用户内容，送译只会被 LLM 嵌套再翻
 * 6 含占位符 → 放行，占位符 token 化保护后送译，译后校验（见静态方法组）
 * 7 默认 → 放行
 */
export class FilterEngine {
  /** 单条可送译文本长度上限（字符）；超出拒绝送译（成本与缓存硬上限，v1.1.5） */
  static readonly MAX_TRANSLATABLE_CHARS = 2000;

  private userPatterns: RegExp[] = [];
  /** 目标语言（规则 5c 用；小写归一，缺省为空串 = 不启用 5c） */
  private targetLang = "";

  constructor(skipPatterns: string[] = [], targetLang = "") {
    this.setSkipPatterns(skipPatterns);
    this.setTargetLang(targetLang);
  }

  /** v1.1.5：目标语言热同步（refreshRuntime 时调用） */
  setTargetLang(lang: string): void {
    this.targetLang = lang.trim().toLowerCase();
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
    // 规则 2b：超长文本拒绝（v1.1.5：失控嵌套文本曾把缓存撑到数百 MB、单请求成本失控）
    if (t.length > FilterEngine.MAX_TRANSLATABLE_CHARS) return false;
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
    // 规则 5c（v1.1.5）：目标语言为 zh 系时，含 ≥2 个 CJK 字符即拒绝——
    // 双语回写产物"译文 (原文)"的拉丁字母往往多于汉字、可绕过 5b，此规则从结构上杜绝嵌套再翻
    if (this.targetLang.startsWith("zh") && cjkCount >= 2) return false;
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

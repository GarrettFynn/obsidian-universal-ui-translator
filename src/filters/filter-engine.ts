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
 * 5b CJK 表意字符数 ≥ 拉丁字母数 → 拒绝（R-06：已本地化混合文本，送译只返回原文）——
 *    语言无关的基线防线；代价：译文与原文拉丁字母相当的形态放行，交给 5c/5d 收口
 * 5c 1.4 泛化（原 v1.1.5 仅 zh 系）：目标语言命中 SCRIPT_RANGES 语言族时，文本含
 *    ≥2 个目标脚本字符即拒绝——双语回写产物"译文 (原文)"的拉丁字母往往多于目标脚本
 *    字符、可绕过 5b，此规则从结构上杜绝嵌套再翻。zh 语义与 v1.1.5 逐位一致；
 *    ja/ko/ar 从此受保护。代价：英文原文含 ≥2 个目标脚本字符将被拦（如目标 ja 时的
 *    「Kanban board 看板」）——罕见，Spike 1 已量化（zh/ja 各 2/30 hardCase）
 * 5d 1.4 新增（Spike 1 D3b，无语言门槛）：文本以 ASCII 括号 "(...)" 结尾且含非 ASCII
 *    字符 → 拒绝——双语回写产物的结构特征，收口 5c"≥2 字符"对单汉字标签
 *    （"译 (Translate)"）的盲区；代价：原文含变音符且括号结尾的罕见形态会被拦，
 *    合法括号尾英文（全 ASCII）零误杀（Spike 1 语料实测）
 * 6 含占位符 → 放行，占位符 token 化保护后送译，译后校验（见静态方法组）
 * 7 默认 → 放行
 */

/** 目标语言 → 目标脚本字符区间；键按语言代码前缀匹配（"zh-Hant" → zh）。
 *  注意：ko/ar 不含 CJK——区间表按语言定制，禁止一刀切（Spike 1 实测）。 */
const SCRIPT_RANGES: Readonly<Record<string, RegExp>> = {
  zh: /[\u4e00-\u9fff\u3400-\u4dbf]/g,
  ja: /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]/g,
  ko: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g,
  ar: /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufc0f\ufe70-\ufefc]/g,
};

/** 目标语言 → 语言族键：trim+lowercase 后按 SCRIPT_RANGES 键前缀匹配（"zh-Hant" → "zh"）；
 *  无区间语言（fr/es/de 等拉丁语系、西里尔等）返回 null。1.4 起供 openai-provider
 *  做 Prompt Profile 族归一复用（设计 3.1 指定的共享位置）。 */
export function scriptFamilyOf(lang: string): string | null {
  const l = lang.trim().toLowerCase();
  for (const key of Object.keys(SCRIPT_RANGES)) {
    if (l.startsWith(key)) return key;
  }
  return null;
}

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
    // 规则 5c（1.4 泛化，原 v1.1.5 仅 zh）：目标语言命中脚本区间表时，含 ≥2 个目标脚本
    // 字符即拒绝——双语回写产物"译文 (原文)"可绕过 5b，此规则从结构上杜绝嵌套再翻；
    // zh 走的区间与旧实现逐位一致，拉丁语系等无区间语言不启用（scriptFamilyOf 返回 null）
    const family = scriptFamilyOf(this.targetLang);
    if (family !== null) {
      const targetScriptCount = (t.match(SCRIPT_RANGES[family]) ?? []).length;
      if (targetScriptCount >= 2) return false;
    }
    // 规则 5d（1.4 新增，Spike 1 D3b，无语言门槛）：以 ASCII 括号 "(...)" 结尾且含非
    // ASCII 字符 → 拒绝——双语回写产物的结构特征，收口 5c 对单汉字标签的盲区
    if (/\([^()]*\)\s*$/.test(t) && /[^\x20-\x7e]/.test(t)) return false;
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

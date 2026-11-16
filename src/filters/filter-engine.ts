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
    if (/^([a-zA-Z]:[\\/]|[\\/]|~[\\/]|\\.{1,2}[\\/])/.test(t)) return false;
    if (/^[\w.-]+([\\/][\w .-]+)+$/.test(t)) return false;
    if (/^[\w-]+\.[a-zA-Z0-9]{1,5}$/.test(t)) return false;
    // 规则 3b（1.5 G1）：技术标识符——整串 kebab-case / snake_case（如 obsidian-git、
    // universal-ui-translator、config_setting）。自然语言文案极少呈整串全小写连字/下划线
    // 形态（正常文案首字母大写或多词成句）；drag-and-drop 这类连字短语保留原文亦是业界惯例。
    // 误伤可由用户 skipPatterns 反向覆盖不了（跳过类规则）——量级极低，接受。
    if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(t)) return false;
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(t)) return false;
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

  /**
   * 1.5（G2）：专名形态判定——1~4 个首字母大写词（如 "Dataview"、"Obsidian Git"、
   * "Michael Brenan"）。仅市场条目卡片的收集阶段使用（卡片内容 = 插件显示名+作者名+
   * 下载量+简介，前三者按此形态跳过送译保留原文；详情 README 的章节标题同形态但
   * 那里不启用——避免漏译 "Installation" 等标题）。
   */
  static isProperNounLike(text: string): boolean {
    return /^[A-Z][\w&'.-]*(\s+[A-Z][\w&'.-]*){0,3}$/.test(text.trim());
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
   * 1.6（C1）：单趟联合提取——显式占位符（{0}/%s/{{var}}）与裸数字（整数/小数/千分位/
   * 百分比）合并正则一次扫描、统一编号后逐 span 替换为 __UUTPHn__。
   * 禁止两层串行调用 protectPlaceholders：两函数各自从 0 编号且数字正则会互噬 token
   * 下标数字（审查实测 "%s" 丢失、"{{user2}}" 破坏）；replace 单趟天然规避互噬。
   * 数字负向前瞻 (?![\da-zA-Z]) 排除粘连形态：字母紧跟（1st/10K）与回溯截断的数字
   * 前缀（"10K" 中 \d+ 贪婪 "10" 被拒后回溯 "1"——前瞻同时排除数字，短前缀即被拒绝，
   * 整个数字串保持原样；C 批次门禁实测抓出）。B2B 前后皆字母天然不 mask。
   * 动态数字模板（"New preset: 540/1234" 型）masked 后同模板共享缓存键——归一化缓存的根基。
   */
  private static readonly MASK_PATTERN_SOURCE =
    "\\{\\d+\\}|%[sd]|\\{\\{[^}]+\\}\\}|\\d+(?:[.,]\\d+)*%?(?![\\da-zA-Z])";

  static maskAll(text: string): {
    masked: string;
    /** 与 masked 中 __UUTPHn__ 一一对应的原文 span（显式占位符原文形态或数字原文） */
    spans: string[];
    /** spans 中数字分支的原文值（还原校验用） */
    numericValues: string[];
  } {
    const tokens: string[] = [];
    const spans: string[] = [];
    const numericValues: string[] = [];
    // 每次从 source 新建（/g 的 lastIndex 有状态，静态复用会跨调用串位）
    const re = new RegExp(FilterEngine.MASK_PATTERN_SOURCE, "g");
    const masked = text.replace(re, (m) => {
      const token = `__UUTPH${tokens.length}__`;
      tokens.push(token);
      spans.push(m);
      // 显式占位符以 { 或 % 开头；数字分支以数字开头（还原校验只盯数字值）
      if (/^\d/.test(m)) numericValues.push(m);
      return token;
    });
    return { masked, spans, numericValues };
  }

  /**
   * 1.6（C3）：按 spans 还原（token → 原文 span，含数字值）。
   * 与既有 restorePlaceholders（token → token，供显式占位符直接回填）不同——
   * maskAll 的 token 必须回填原文值，数字模板跨缓存命中才能各自还原正确数字。
   */
  static restoreSpans(translated: string, spans: string[]): string {
    let out = translated;
    spans.forEach((span, i) => {
      out = out.split(`__UUTPH${i}__`).join(span);
    });
    return out;
  }

  /**
   * 1.6（C2）：还原校验——masked 态译文的 token 编号集合必须与送译 masked 完全一致
   * （不多不少：少 = 模型吞 token，多 = 模型幻觉 token），且还原后每个数字 token 的值
   * 须以字符串形式出现（对正确还原是恒真安全网：guard 住"token 未被回填值"类回归；
   * 已知边界：千分位形态译文去逗号会被误杀——罕见，接受，走回退原文）。
   * 通过返回还原后的译文；违例返回 null（调用方走 failed：回退原文、不写缓存）。
   */
  static validateAndRestore(
    rawMasked: string,
    spans: string[],
    numericValues: string[]
  ): string | null {
    const expected = new Set(spans.map((_, i) => `__UUTPH${i}__`));
    const found = new Set<string>();
    const re = /__UUTPH\d+__/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawMasked)) !== null) found.add(m[0]);
    for (const tk of expected) {
      if (!found.has(tk)) return null;
    }
    for (const tk of found) {
      if (!expected.has(tk)) return null;
    }
    const restored = FilterEngine.restoreSpans(rawMasked, spans);
    for (const v of numericValues) {
      if (!restored.includes(v)) return null;
    }
    return restored;
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

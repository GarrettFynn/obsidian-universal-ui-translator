import { describe, expect, it } from "vitest";
import { FilterEngine } from "../src/filters/filter-engine";

/**
 * Spike 1 矩阵回归子集（1.4 批次一）：
 * 脚本检测泛化后 zh/ja/ko/ar 四语言的纯译文 / 混合译文 / 双语产物（括号与管道两种
 * 回写格式）应拒、clean 英文与括号尾英文应放。
 * 红线 8：测试不得 import spikes/——语料代表样本值自
 * spikes/spike-1-script-detect/corpus.ts 内联复制。
 */

// ---------- 语料（内联，与 spike-1 corpus.ts 逐字一致） ----------

const PURE: Record<"zh" | "ja" | "ko" | "ar", string[]> = {
  zh: ["打开命令面板", "打开设置"],
  ja: ["コマンドパレットを開く", "設定を開く"],
  ko: ["명령 팔레트 열기", "설정 열기"],
  ar: ["فتح لوحة الأوامر", "فتح الإعدادات"],
};

/** 混合译文（"译文含拉丁字母"形态，规则 5b 的盲区样本）；ja 两条均含假名/片假名 */
const MIXED: Record<"zh" | "ja" | "ko" | "ar", string[]> = {
  zh: ["复制 URL", "导出 PDF"],
  ja: ["PDF をエクスポート", "Web ページを開く"],
  ko: ["PDF로 내보내기", "URL 복사"],
  ar: ["تصدير PDF", "نسخ URL"],
};

/** 双语回写产物测试样本 = display-mode 两种格式的拼装结果（{t} ({o}) 与 {o} | {t}） */

const CLEAN = [
  "Open command palette",
  "Open settings",
  "Search all files",
  "Toggle left sidebar",
  "New tab",
];

const PAREN_TAIL = ["Graph view (beta)", "Sync (experimental)"];

// ---------- 断言主体 ----------

const engines = {
  zh: new FilterEngine([], "zh-CN"),
  ja: new FilterEngine([], "ja"),
  ko: new FilterEngine([], "ko"),
  ar: new FilterEngine([], "ar"),
  fr: new FilterEngine([], "fr"),
} as const;

type ScriptLang = keyof typeof PURE;

describe("脚本检测泛化回归（Spike 1 子集）", () => {
  for (const lang of Object.keys(PURE) as ScriptLang[]) {
    describe(`${lang} 目标语言`, () => {
      const fe = engines[lang];

      it("纯译文 2 条拒绝", () => {
        for (const s of PURE[lang]) expect(fe.shouldTranslate(s)).toBe(false);
      });

      it("混合译文 2 条拒绝（5c 目标脚本计数）", () => {
        for (const s of MIXED[lang]) expect(fe.shouldTranslate(s)).toBe(false);
      });

      it("双语括号产物 2 条拒绝", () => {
        expect(fe.shouldTranslate(`${PURE[lang][1]} (Open settings)`)).toBe(false);
        expect(fe.shouldTranslate(`${MIXED[lang][0]} (Export to PDF)`)).toBe(false);
      });

      it("双语管道产物 2 条拒绝", () => {
        expect(fe.shouldTranslate(`Open settings | ${PURE[lang][1]}`)).toBe(false);
        expect(fe.shouldTranslate(`Word count | ${MIXED[lang][0]}`)).toBe(false);
      });
    });
  }

  describe("clean 英文原文（零误杀基线）", () => {
    // zh/ja/ko/ar 四脚本目标 + fr 拉丁目标下，clean 5 条 + 括号尾英文 2 条全部放行
    for (const [lang, fe] of Object.entries(engines) as Array<
      [keyof typeof engines, FilterEngine]
    >) {
      it(`${lang} 目标下 clean 5 条 + 括号尾英文 2 条放行`, () => {
        for (const s of [...CLEAN, ...PAREN_TAIL]) expect(fe.shouldTranslate(s)).toBe(true);
      });
    }
  });
});

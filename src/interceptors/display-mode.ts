import { BilingualFormat, DisplayMode } from "../types";

/**
 * 回写格式化（设计文档 5.1 三种显示模式）
 * - replace：仅译文
 * - bilingual：按 bilingualFormat 组合（默认 译文 (原文)）
 * - original 或译文与原文相同：返回 null——不回写（翻译流水线已预热缓存，5.1 original 语义）
 */
export function formatWriteBack(
  translated: string,
  original: string,
  mode: DisplayMode,
  format: BilingualFormat
): string | null {
  if (translated === original) return null;
  if (mode === "original") return null;
  if (mode === "bilingual") {
    return format === "{t} ({o})"
      ? `${translated} (${original})`
      : `${original} | ${translated}`;
  }
  return translated;
}

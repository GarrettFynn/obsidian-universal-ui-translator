/**
 * 展示层数字格式化与费用估算纯函数（v1.3 token 统计）
 * 独立模块便于单测；主流程零 IO、零依赖
 */

/** 紧凑数字：<1000 原样；≥1000 → x.xk；≥1e6 → x.xM（保留 1 位小数） */
export function fmtCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 费用：≥1 两位小数（¥12.34）；<1 三位小数（¥0.004——低价模型日耗常见量级） */
export function fmtCost(v: number, currency = "¥"): string {
  return v >= 1 ? `${currency}${v.toFixed(2)}` : `${currency}${v.toFixed(3)}`;
}

export interface TokenPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** token 费用估算：(输入×输入单价 + 输出×输出单价) / 1e6 */
export function estimateTokenCost(
  inTokens: number,
  outTokens: number,
  price: TokenPrice
): number {
  return (inTokens * price.inputPerMillion + outTokens * price.outputPerMillion) / 1_000_000;
}

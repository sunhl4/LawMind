/**
 * Lawyer-facing usage sentence. Browser-safe: no node:fs.
 * The ledger itself lives in model-usage.ts and must stay off the renderer graph.
 */

/**
 * 律师可见的用量一句话。有记录才写数字；零记录返回 null（UI 显示「尚无记录」）。
 * 不编造 ¥ / 套餐额度——账本只有 token。
 */
export function formatUsageSummaryForLawyer(
  summary: {
    entries: number;
    totalTokens: number;
    byTier?: Array<{ label: string; totalTokens: number }>;
  },
  opts?: { sinceDays?: number },
): string | null {
  if (summary.entries <= 0 || summary.totalTokens <= 0) {
    return null;
  }
  const days = opts?.sinceDays && opts.sinceDays > 0 ? opts.sinceDays : 30;
  const tokens = summary.totalTokens.toLocaleString("zh-CN");
  const tierBit =
    summary.byTier && summary.byTier.length > 0
      ? `；其中 ${summary.byTier
          .map((t) => `${t.label} ${t.totalTokens.toLocaleString("zh-CN")}`)
          .join("、")}`
      : "";
  return `近 ${days} 天 ${summary.entries} 次调用，约 ${tokens} token${tierBit}。自备密钥的调用记在本机，不记入套餐。`;
}

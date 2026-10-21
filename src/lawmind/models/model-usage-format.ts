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
    unknownUsageEntries?: number;
    byTier?: Array<{ label: string; totalTokens: number }>;
  },
  opts?: { sinceDays?: number },
): string | null {
  const unknown = summary.unknownUsageEntries ?? 0;
  if (summary.entries <= 0 || (summary.totalTokens <= 0 && unknown === 0)) {
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
  const usage = summary.totalTokens > 0 ? `已报告约 ${tokens} token${tierBit}` : "上游尚未报告用量";
  return `近 ${days} 天 ${summary.entries} 次调用，${usage}${unknown > 0 ? `；${unknown} 次用量未知，不代表免费` : ""}。自备密钥的调用记在本机，不记入套餐。`;
}

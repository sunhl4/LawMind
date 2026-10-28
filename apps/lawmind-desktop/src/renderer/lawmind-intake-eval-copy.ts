/** 判案评测的展示口径：没有律师归案标签就不显示，避免 0/0 的假成绩。 */

export type MatchingEvalSummary = {
  falseAttach: number;
  recallAt1: number | null;
  source: { labeled: number; scanMayBeTruncated: boolean };
};

export function matchingEvalLine(report: MatchingEvalSummary | null | undefined): string | null {
  if (!report || report.source.labeled <= 0) {
    return null;
  }
  const recall =
    report.recallAt1 === null ? "—" : `${Math.round(report.recallAt1 * 100)}%`;
  const truncated = report.source.scanMayBeTruncated ? "（只看最近 500 条）" : "";
  return `判案评测：最近 ${report.source.labeled} 条律师归案，误归 ${report.falseAttach}，第一名命中 ${recall}。${truncated}`;
}

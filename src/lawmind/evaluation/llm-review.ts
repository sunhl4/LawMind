/**
 * Offline LLM-review agreement harness.
 * Live model scoring is opt-in later; this module never calls the network.
 */

export type LlmReviewLabel = {
  caseId: string;
  defectRecalled: boolean;
  stanceCovered: boolean;
  citationOk: boolean;
  complete: boolean;
};

export type LlmReviewAgreement = {
  cases: number;
  agreement: number;
  reportZh: string;
};

function rowScore(a: LlmReviewLabel, b: LlmReviewLabel): number {
  const keys = ["defectRecalled", "stanceCovered", "citationOk", "complete"] as const;
  let hit = 0;
  for (const k of keys) {
    if (a[k] === b[k]) {
      hit += 1;
    }
  }
  return hit / keys.length;
}

/** Pairwise agreement in [0,1]. Empty input → null agreement. */
export function scoreLlmReviewAgreement(
  human: LlmReviewLabel[],
  model: LlmReviewLabel[],
): LlmReviewAgreement {
  const byId = new Map(model.map((r) => [r.caseId, r]));
  const paired = human.filter((h) => byId.has(h.caseId));
  if (paired.length === 0) {
    return { cases: 0, agreement: 0, reportZh: "无成对样本，评审分不入门禁。" };
  }
  const agreement =
    paired.reduce((sum, h) => sum + rowScore(h, byId.get(h.caseId)!), 0) / paired.length;
  const pct = Math.round(agreement * 1000) / 10;
  return {
    cases: paired.length,
    agreement,
    reportZh:
      agreement >= 0.8
        ? `评审一致率 ${pct}%（${paired.length} 案），可入门禁。`
        : `评审一致率 ${pct}%（${paired.length} 案）<80%，评审分不入门禁。`,
  };
}

import { describe, expect, it } from "vitest";
import { scoreLlmReviewAgreement, type LlmReviewLabel } from "./llm-review.js";

const row = (id: string, over: Partial<LlmReviewLabel> = {}): LlmReviewLabel => ({
  caseId: id,
  defectRecalled: true,
  stanceCovered: true,
  citationOk: true,
  complete: true,
  ...over,
});

describe("scoreLlmReviewAgreement", () => {
  it("requires 80% before the score may enter a gate", () => {
    const human = [row("a"), row("b")];
    const agree = scoreLlmReviewAgreement(human, human);
    expect(agree.agreement).toBe(1);
    expect(agree.reportZh).toContain("可入门禁");

    const drift = scoreLlmReviewAgreement(human, [
      row("a"),
      row("b", { complete: false, citationOk: false }),
    ]);
    expect(drift.agreement).toBeLessThan(0.8);
    expect(drift.reportZh).toContain("不入门禁");
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_CAUSE_LEXICON, suggestCauseCandidates } from "./cause-lexicon.js";

describe("suggestCauseCandidates", () => {
  it("suggests labor and loan from oral narrative", () => {
    const labor = suggestCauseCandidates("公司一直拖欠工资还把我开除了", {
      causes: [...DEFAULT_CAUSE_LEXICON],
    });
    expect(labor.some((c) => c.label === "劳动争议")).toBe(true);
    const loan = suggestCauseCandidates("他借了二十万一直不还，有借条", {
      causes: [...DEFAULT_CAUSE_LEXICON],
    });
    expect(loan.some((c) => c.label === "民间借贷纠纷")).toBe(true);
  });
});

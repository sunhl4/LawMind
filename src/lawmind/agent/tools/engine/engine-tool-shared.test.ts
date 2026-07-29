import { describe, expect, it } from "vitest";
import { canDraftWithoutResearch, shouldRefuseDraftOnDemoCorpus } from "./engine-tool-shared.js";

describe("canDraftWithoutResearch", () => {
  it("allows draft.word and analyze.contract when deliverableType is set", () => {
    expect(
      canDraftWithoutResearch({ kind: "draft.word", deliverableType: "contract.rental" }),
    ).toBe(true);
    expect(
      canDraftWithoutResearch({ kind: "analyze.contract", deliverableType: "contract.review" }),
    ).toBe(true);
  });

  it("denies when deliverableType missing or kind is research-only", () => {
    expect(canDraftWithoutResearch({ kind: "draft.word" })).toBe(false);
    expect(canDraftWithoutResearch({ kind: "analyze.contract" })).toBe(false);
    expect(
      canDraftWithoutResearch({ kind: "research.legal", deliverableType: "contract.review" }),
    ).toBe(false);
  });
});

describe("shouldRefuseDraftOnDemoCorpus", () => {
  it("refuses high- and medium-risk intents (conservative default, N-A3)", () => {
    expect(shouldRefuseDraftOnDemoCorpus({ riskLevel: "high" })).toBe(true);
    expect(shouldRefuseDraftOnDemoCorpus({ riskLevel: "medium" })).toBe(true);
    expect(shouldRefuseDraftOnDemoCorpus({ riskLevel: "low" })).toBe(false);
    expect(shouldRefuseDraftOnDemoCorpus({})).toBe(false);
  });
});

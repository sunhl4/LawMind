import { describe, expect, it } from "vitest";
import {
  canDraftWithoutResearch,
  resolveMatterId,
  shouldRefuseDraftOnDemoCorpus,
} from "./engine-tool-shared.js";

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

describe("resolveMatterId", () => {
  it("accepts Unicode matter folder names", () => {
    expect(resolveMatterId("临时讨论")).toBe("临时讨论");
    expect(resolveMatterId(undefined, "张三买卖合同纠纷")).toBe("张三买卖合同纠纷");
  });

  it("rejects path traversal and separators", () => {
    expect(() => resolveMatterId("../x")).toThrow(/matter_id/);
    expect(() => resolveMatterId("甲/乙")).toThrow(/matter_id/);
  });
});

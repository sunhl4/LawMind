import { describe, expect, it } from "vitest";
import { compileIntakeBrief } from "./intake-brief.js";

describe("compileIntakeBrief", () => {
  it("extracts needs, facts, cause and evidence gaps from a client talk", () => {
    const brief = compileIntakeBrief({
      matterId: "m-talk",
      workspaceDir: "/tmp/lm-no-lexicon",
      transcript:
        "客户希望把拖欠的货款要回来。对方一直拖着不还。我们有转账凭证和聊天记录，合同还在找。",
    });
    expect(brief.clientNeeds.length).toBeGreaterThan(0);
    expect(brief.causeCandidates.some((c) => /买卖|借贷/.test(c.label))).toBe(true);
    expect(brief.evidenceGaps.length + brief.coreFacts.length).toBeGreaterThan(0);
    expect(brief.nextActions.some((a) => a.includes("证据"))).toBe(true);
  });
});

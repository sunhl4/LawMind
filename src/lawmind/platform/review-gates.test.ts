import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  deriveReviewGateDecisions,
  formatGateDecisionLine,
  listBlockingGateDecisions,
} from "./review-gates.js";

const draftBase: ArtifactDraft = {
  taskId: "t-1",
  title: "Test",
  output: "docx",
  templateId: "word/demand-letter-default",
  summary: "",
  sections: [{ heading: "H", body: "B" }],
  reviewNotes: [],
  reviewStatus: "pending",
  createdAt: new Date().toISOString(),
};

describe("platform/review-gates", () => {
  it("derives approval awaiting + acceptance block", () => {
    const gates = deriveReviewGateDecisions(draftBase, {
      taskId: "t-1",
      ready: false,
      checks: [],
      blockerCount: 1,
      warningCount: 0,
      placeholderCount: 0,
      placeholderSamples: [],
      generatedAt: new Date().toISOString(),
      deliverableType: "demand-letter",
    });
    expect(
      gates.some((g) => g.gate === "approval_gate" && g.decision === "awaiting_confirmation"),
    ).toBe(true);
    expect(gates.some((g) => g.gate === "acceptance_gate" && g.decision === "block")).toBe(true);
  });

  it("lists blocking gates and formats lines", () => {
    const blocking = listBlockingGateDecisions([
      { gate: "acceptance_gate", decision: "block", reason: "缺章节" },
      { gate: "approval_gate", decision: "allow" },
    ]);
    expect(blocking).toHaveLength(1);
    expect(formatGateDecisionLine(blocking[0])).toBe("验收门禁：缺章节");
  });
});

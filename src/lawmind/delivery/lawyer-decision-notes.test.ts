import { describe, expect, it } from "vitest";
import type { LegalLintFinding } from "../lint/types.js";
import type { ArtifactDraft } from "../types.js";
import { attachLawyerDecisionNotes, lawyerDecisionLines } from "./lawyer-decision-notes.js";

function finding(ruleId: string, message: string): LegalLintFinding {
  return {
    ruleId,
    family: ruleId.startsWith("form.") ? "form" : "statutory_cap",
    severity: "warning",
    message,
    fixable: false,
  };
}

function draft(partial: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t1",
    title: "意见",
    summary: "摘要",
    sections: [{ heading: "正文", body: "租赁期限五年。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    output: "docx",
    createdAt: "2026-09-27T00:00:00.000Z",
    ...partial,
  };
}

describe("lawyerDecisionLines", () => {
  it("keeps judgment findings and drops mechanical ones", () => {
    const lines = lawyerDecisionLines([
      finding("statutory.deposit_cap", "定金比例超过法定上限"),
      finding("consistency.article_numbering", "条款编号不连续"),
      finding("form.or_arbitrate_or_sue", "同时约定了仲裁和诉讼"),
    ]);
    expect(lines).toEqual(["需您定夺：定金比例超过法定上限", "需您定夺：同时约定了仲裁和诉讼"]);
  });
});

describe("attachLawyerDecisionNotes", () => {
  it("appends a section on a new document", () => {
    const next = draft();
    const lines = attachLawyerDecisionNotes(next, [
      finding("statutory.deposit_cap", "定金比例超过法定上限"),
    ]);
    expect(lines).toHaveLength(1);
    expect(next.sections.map((section) => section.heading)).toEqual(["正文", "需您定夺"]);
    expect(next.sections[1]?.body).toContain("定金比例超过法定上限");
  });

  it("does not write the note into a tracked contract body", () => {
    const next = draft({
      contractEdit: {
        baselineRelativePath: "a.docx",
        baselineRoot: "workspace",
      } as ArtifactDraft["contractEdit"],
      pairedOpinionSections: [{ heading: "意见", body: "建议收窄违约金。" }],
    });
    attachLawyerDecisionNotes(next, [finding("form.or_arbitrate_or_sue", "或裁或诉需您选择")]);
    expect(next.sections).toHaveLength(1);
    expect(next.pairedOpinionSections?.map((section) => section.heading)).toEqual([
      "意见",
      "需您定夺",
    ]);
  });
});

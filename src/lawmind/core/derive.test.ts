import { describe, expect, it } from "vitest";
import type { ArtifactDraft, MatterIndex } from "../types.js";
import { classifyDeliverableKind, deriveMatterStatus, needsEvidenceFollowup } from "./derive.js";

describe("derive helpers", () => {
  it("classifies contract drafts", () => {
    const draft = {
      templateId: "contract-msa",
      title: "MSA review",
      summary: "vendor contract",
      output: "docx",
    } as ArtifactDraft;
    expect(classifyDeliverableKind(draft)).toBe("contract-review");
  });

  it("derives intake for empty matter index", () => {
    const index = {
      matterId: "m-1",
      tasks: [],
      drafts: [],
      openTasks: [],
      renderedTasks: [],
      caseMemory: "",
      coreIssues: [],
      taskGoals: [],
      riskNotes: [],
    } as unknown as MatterIndex;
    expect(deriveMatterStatus(index)).toBe("intake");
  });

  it("detects evidence follow-up phrasing", () => {
    expect(needsEvidenceFollowup("需补充证据材料")).toBe(true);
    expect(needsEvidenceFollowup("结论明确")).toBe(false);
  });
});

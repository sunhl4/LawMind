import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import {
  draftDocumentEditorValueFromDraft,
  draftDocumentEditorValuesEqual,
  draftDocumentEditorValueToPatch,
  isDraftDocumentEditable,
} from "./lawmind-draft-document-editor";

const baseDraft: ArtifactDraft = {
  taskId: "task-1",
  title: "合同审查意见",
  output: "docx",
  templateId: "word/contract-default",
  summary: "总体风险可控",
  sections: [
    { heading: "结论", body: "建议签署", citations: ["src-1"] },
    { heading: "细节", body: "需补充保密条款" },
  ],
  reviewNotes: [],
  reviewStatus: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("lawmind-draft-document-editor", () => {
  it("maps draft to editor value and back", () => {
    const value = draftDocumentEditorValueFromDraft(baseDraft);
    expect(value.title).toBe("合同审查意见");
    expect(value.sections).toHaveLength(2);
    expect(draftDocumentEditorValueToPatch(value).sections[0]?.citations).toEqual(["src-1"]);
  });

  it("detects dirty state via equality", () => {
    const left = draftDocumentEditorValueFromDraft(baseDraft);
    const right = draftDocumentEditorValueFromDraft(baseDraft);
    expect(draftDocumentEditorValuesEqual(left, right)).toBe(true);
    right.sections[0].body = "修改后";
    expect(draftDocumentEditorValuesEqual(left, right)).toBe(false);
  });

  it("allows edit only for pending and modified", () => {
    expect(isDraftDocumentEditable("pending")).toBe(true);
    expect(isDraftDocumentEditable("modified")).toBe(true);
    expect(isDraftDocumentEditable("approved")).toBe(false);
    expect(isDraftDocumentEditable("rejected")).toBe(false);
  });

  it("defaults missing title and summary to empty strings", () => {
    const { summary: _s, ...noSummary } = baseDraft;
    const value = draftDocumentEditorValueFromDraft(noSummary as ArtifactDraft);
    expect(value.summary).toBe("");
    expect(() => value.summary.trim()).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { reviewDraftFingerprint } from "./useReviewWorkbenchData";

function draft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "d-1",
    title: "合同审查意见",
    output: "docx",
    templateId: "word/legal-memo-default",
    summary: "摘要",
    sections: [{ heading: "结论", body: "可以签署。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  } as ArtifactDraft;
}

describe("reviewDraftFingerprint", () => {
  it("stays stable when nothing visible changed", () => {
    expect(reviewDraftFingerprint(draft())).toBe(reviewDraftFingerprint(draft()));
  });

  it("changes when the body changes", () => {
    expect(reviewDraftFingerprint(draft())).not.toBe(
      reviewDraftFingerprint(
        draft({ sections: [{ heading: "结论", body: "第 8 条需要改。" }] }),
      ),
    );
  });

  it("changes when the review status changes", () => {
    expect(reviewDraftFingerprint(draft())).not.toBe(
      reviewDraftFingerprint(draft({ reviewStatus: "approved" })),
    );
  });
});

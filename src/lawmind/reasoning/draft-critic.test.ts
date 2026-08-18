import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { applyDraftCritic, critiqueDraft } from "./draft-critic.js";

function draft(partial: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t-critic-1",
    title: "房屋租赁合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.rental",
    summary: "测",
    sections: [{ heading: "租金", body: "乙方应当按月支付租金。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("draft-critic", () => {
  it("adds review notes without rewriting sections", () => {
    const original = draft();
    const next = applyDraftCritic(original);
    expect(next.sections).toEqual(original.sections);
    expect(next.reviewNotes.some((n) => n.startsWith("复核："))).toBe(true);
    expect(next.reviewNotes.some((n) => n.includes("争议解决"))).toBe(true);
  });

  it("does not run twice", () => {
    const once = applyDraftCritic(draft());
    const twice = applyDraftCritic(once);
    expect(twice.reviewNotes).toEqual(once.reviewNotes);
  });

  it("flags a demand letter missing a deadline", () => {
    const notes = critiqueDraft(
      draft({
        title: "律师函",
        deliverableType: "letter.demand",
        sections: [{ heading: "主张", body: "请立即履行付款义务。" }],
      }),
    );
    expect(notes.some((n) => n.includes("履行期限"))).toBe(true);
  });
});

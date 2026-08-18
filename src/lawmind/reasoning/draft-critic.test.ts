import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { applyDraftCritic, applyDraftCriticAsync, critiqueDraft } from "./draft-critic.js";

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

  describe("model critic", () => {
    const prev = { ...process.env };

    afterEach(() => {
      process.env = { ...prev };
      vi.unstubAllGlobals();
    });

    it("stays on rules when LAWMIND_REASONING_MODE=keyword", async () => {
      process.env.LAWMIND_REASONING_MODE = "keyword";
      process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
      process.env.LAWMIND_AGENT_API_KEY = "sk-test";
      process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const next = await applyDraftCriticAsync(draft());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(next.reviewNotes.some((n) => n.includes("争议解决"))).toBe(true);
      expect(next.sections).toEqual(draft().sections);
    });

    it("appends model notes without rewriting sections", async () => {
      delete process.env.LAWMIND_REASONING_MODE;
      process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
      process.env.LAWMIND_AGENT_API_KEY = "sk-test";
      process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    notes: ["押金退还条件写得太笼统，执行时容易争。"],
                  }),
                },
              },
            ],
          }),
        })),
      );
      const original = draft();
      const next = await applyDraftCriticAsync(original);
      expect(next.sections).toEqual(original.sections);
      expect(next.reviewNotes.some((n) => n.includes("争议解决"))).toBe(true);
      expect(next.reviewNotes.some((n) => n.startsWith("复核：") && n.includes("押金"))).toBe(true);
    });
  });
});

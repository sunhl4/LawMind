import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  applyDraftCritic,
  applyDraftCriticAsync,
  critiqueDraft,
  runDraftCriticAsync,
} from "./draft-critic.js";

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
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  clauses: [{ id: "c1", notes: ["押金退还条件写得太笼统，执行时容易争。"] }],
                  summary: ["全文押金条款可执行性不足。"],
                }),
              },
            },
          ],
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      const original = draft();
      const { draft: next, graph } = await runDraftCriticAsync(original);
      expect(next.sections).toEqual(original.sections);
      expect(next.reviewNotes.some((n) => n.includes("争议解决"))).toBe(true);
      expect(next.reviewNotes.some((n) => n.startsWith("复核：") && n.includes("押金"))).toBe(true);
      expect(
        graph.clauses.some((clause) => clause.criticNotes.some((note) => note.includes("押金"))),
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("runs a second notes-only pass on flagged clauses of a long draft", async () => {
      delete process.env.LAWMIND_REASONING_MODE;
      process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
      process.env.LAWMIND_AGENT_API_KEY = "sk-test";
      process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
      const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
        const body = typeof init?.body === "string" ? init.body : "";
        const isSecond = body.includes("需二次复核的条款");
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    isSecond
                      ? {
                          clauses: [{ id: "c1", notes: ["长稿第二轮：义务条款仍缺后果。"] }],
                          summary: [],
                        }
                      : {
                          clauses: [{ id: "c1", notes: ["第一轮：租金义务偏软。"] }],
                          summary: [],
                        },
                  ),
                },
              },
            ],
          }),
        };
      });
      vi.stubGlobal("fetch", fetchMock);
      const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
      const articles = numerals
        .map((n, idx) =>
          idx === 0
            ? `第${n}条 条款1\n乙方应当履行第1项义务。`
            : `第${n}条 条款${idx + 1}\n本条确认房屋坐落与租赁用途。`,
        )
        .join("\n");
      const original = draft({
        sections: [{ heading: "合同正文", body: articles }],
      });
      const { draft: next, graph } = await runDraftCriticAsync(original);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(next.sections).toEqual(original.sections);
      expect(graph.clauses.length).toBeGreaterThan(8);
      expect(next.reviewNotes.some((note) => note.includes("长稿第二轮"))).toBe(true);
      const secondBody = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
      expect(secondBody).toContain("需二次复核的条款");
      expect(secondBody).toContain("c1");
      expect(secondBody).not.toContain("c9");
    });
  });
});

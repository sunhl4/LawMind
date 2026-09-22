/**
 * Cassette lock: empty hunk is a same-turn tool error.
 * Assert the bounce is in the *next model request body*, not only turn.messages.
 */
import { describe, expect, it } from "vitest";
import {
  SAME_TURN_VERIFY_DIGEST_PREFIX,
  SAME_TURN_VERIFY_USER_PREFIX,
} from "../runtime/same-turn-verify.js";
import { estimateTextTokens } from "./context-budget.js";
import { sessionHistoryToSimpleMessages } from "./session.js";
import { cassetteAssistant, cassetteToolCall, withTestLawMind } from "./testkit/index.js";

describe("same-turn verify cassette", () => {
  it("empty hunk forces another apply_surgical_edits; 已完成 is not accepted", async () => {
    const calls: Array<{ pending: number; craft?: unknown }> = [];
    await withTestLawMind(
      (b) =>
        b.withMaxToolCalls(12).withToolExecute("apply_surgical_edits", async (args) => {
          const n = calls.length;
          if (n === 0) {
            calls.push({ pending: 0, craft: args.craft_check });
            return {
              ok: true,
              data: { redlinePending: 0, craftCheck: args.craft_check ?? null, taskId: "t1" },
            };
          }
          calls.push({ pending: 1, craft: args.craft_check });
          return {
            ok: true,
            data: {
              redlinePending: 1,
              craftCheck: args.craft_check ?? { deferred: [] },
              taskId: "t1",
            },
          };
        }),
      async (h) => {
        h.enqueue(
          cassetteToolCall("apply_surgical_edits", { edits: [{ find: "甲", replace: "甲" }] }),
          cassetteAssistant("已完成。"),
          cassetteToolCall("apply_surgical_edits", {
            edits: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会" }],
            craft_check: { deferred: [] },
          }),
          cassetteAssistant("已按验收补改。"),
        );
        const result = await h.runTurn("请按词修订这份合同，继续不澄清");
        expect(calls).toHaveLength(2);
        expect(calls[0]?.pending).toBe(0);
        expect(calls[1]?.pending).toBe(1);
        const toolResults = result.turn.messages.flatMap((m) => m.toolCallResponses ?? []);
        expect(toolResults[0]?.result.ok).toBe(false);
        expect(String(toolResults[0]?.result.error ?? "")).toContain(SAME_TURN_VERIFY_USER_PREFIX);
        const failJson = JSON.stringify(toolResults[0]?.result);
        expect(failJson.split(SAME_TURN_VERIFY_USER_PREFIX).length - 1).toBe(1);
        expect(toolResults[1]?.result.ok).toBe(true);
        expect(result.turn.status).toBe("completed");
        expect(result.reply).toContain("已按验收补改");
        expect(h.requests.length).toBeGreaterThanOrEqual(2);
        expect(h.request(1).contains(SAME_TURN_VERIFY_USER_PREFIX)).toBe(true);
        const session = h.session();
        expect(session).toBeDefined();
        expect(
          session!.conversationHistory.some(
            (m) => m.hiddenFromLawyer === true && m.content.includes(SAME_TURN_VERIFY_USER_PREFIX),
          ),
        ).toBe(false);
        expect(
          sessionHistoryToSimpleMessages(session!).some(
            (m) => m.role === "user" && m.text.includes(SAME_TURN_VERIFY_USER_PREFIX),
          ),
        ).toBe(false);
        const bounceRoundTokens = estimateTextTokens(h.request(1).rawBody);
        h.enqueue(cassetteAssistant("收到，下一句接着办。"));
        const follow = await h.runTurn("继续");
        expect(follow.turn.status).toBe("completed");
        const followUp = h.request(-1);
        const followTokens = estimateTextTokens(followUp.rawBody);
        expect(followUp.contains(SAME_TURN_VERIFY_DIGEST_PREFIX)).toBe(false);
        expect(followUp.userTexts().some((t) => t.includes(SAME_TURN_VERIFY_USER_PREFIX))).toBe(
          false,
        );
        console.log(`[token] cassette bounce-round=${bounceRoundTokens} follow-up=${followTokens}`);
      },
    );
  });

  it("refusing to retry after empty hunk pauses the turn instead of completing", async () => {
    const calls: Array<{ pending: number; craft?: unknown }> = [];
    await withTestLawMind(
      (b) =>
        b.withMaxToolCalls(12).withToolExecute("apply_surgical_edits", async (args) => {
          calls.push({ pending: 0, craft: args.craft_check });
          return {
            ok: true,
            data: { redlinePending: 0, craftCheck: args.craft_check ?? null, taskId: "t1" },
          };
        }),
      async (h) => {
        h.enqueue(
          cassetteToolCall("apply_surgical_edits", { edits: [{ find: "甲", replace: "甲" }] }),
        );
        for (let i = 0; i < 8; i += 1) {
          h.enqueue(cassetteAssistant("已完成。"));
        }
        const result = await h.runTurn("请按词修订这份合同，继续不澄清");
        expect(calls).toHaveLength(1);
        expect(result.turn.status).toBe("paused");
        expect(result.turn.requiresAction?.some((a) => a.kind === "continue_tools")).toBe(true);
        expect(result.reply).toContain(SAME_TURN_VERIFY_USER_PREFIX);
        expect(result.reply).not.toMatch(/^已完成/);
        expect(h.request(1).contains(SAME_TURN_VERIFY_USER_PREFIX)).toBe(true);
        const paused = h.session();
        expect(paused).toBeDefined();
        expect(
          paused!.conversationHistory.filter((m) =>
            m.content.startsWith(SAME_TURN_VERIFY_USER_PREFIX),
          ),
        ).toHaveLength(0);
        const digests = paused!.conversationHistory.filter((m) =>
          m.content.startsWith(SAME_TURN_VERIFY_DIGEST_PREFIX),
        );
        expect(digests).toHaveLength(1);
        expect(digests[0]?.hiddenFromLawyer).toBe(true);
        expect(digests[0]?.content).toContain("empty_redline");
      },
    );
  });

  it("Guardian fail on render_document forces another round; 已完成 is not accepted", async () => {
    const calls: string[] = [];
    await withTestLawMind(
      (b) =>
        b.withMaxToolCalls(12).withToolExecute("render_document", async () => {
          const n = calls.length;
          calls.push(n === 0 ? "fail" : "ok");
          if (n === 0) {
            return {
              ok: false,
              error: "独立审稿未过",
              data: {
                code: "legal_guardian_fail",
                gateDecision: { gate: "legal_guardian_gate", decision: "block" },
                guardian: {
                  verdict: "fail",
                  gaps: [{ code: "coverage_gap", message: "未写保留意见" }],
                },
              },
            };
          }
          return { ok: true, data: { taskId: "t1", outputPath: "/tmp/x.docx" } };
        }),
      async (h) => {
        h.enqueue(
          cassetteToolCall("render_document", { task_id: "t1" }),
          cassetteAssistant("已完成。"),
          cassetteToolCall("render_document", { task_id: "t1" }),
          cassetteAssistant("已按审稿补改。"),
        );
        const result = await h.runTurn("请出具法律意见并导出 Word，继续不澄清");
        expect(calls).toEqual(["fail", "ok"]);
        expect(result.turn.status).toBe("completed");
        expect(h.requests.length).toBeGreaterThanOrEqual(2);
        expect(h.requests.some((req) => req.contains(SAME_TURN_VERIFY_USER_PREFIX))).toBe(true);
        expect(h.requests.some((req) => req.contains("未写保留意见"))).toBe(true);
      },
    );
  });

  it("mechanical lint red refuses 已完成 until the writer retries", async () => {
    const drafts: string[] = [];
    await withTestLawMind(
      (b) =>
        b
          .withMaxToolCalls(12)
          .withToolExecute("draft_document", async () => {
            drafts.push("draft");
            return {
              ok: true,
              data: {
                taskId: "lease-1",
                deliverableType: "contract.review",
                draft: {
                  title: "房屋租赁合同",
                  sections: [
                    {
                      heading: "第一条",
                      body: "房屋租赁合同。租赁期限 25 年，租金按月支付。双方按约履行各自义务。",
                    },
                  ],
                },
              },
            };
          })
          .withToolExecute("update_draft", async () => {
            drafts.push("update");
            return {
              ok: true,
              data: {
                taskId: "lease-1",
                deliverableType: "contract.review",
                draft: {
                  title: "房屋租赁合同",
                  sections: [
                    {
                      heading: "第一条",
                      body: "房屋租赁合同。租赁期限 10 年，租金按月支付。双方按约履行各自义务。",
                    },
                  ],
                },
              },
            };
          }),
      async (h) => {
        h.enqueue(
          cassetteToolCall("draft_document", { title: "房屋租赁合同" }),
          cassetteAssistant("已完成。"),
          cassetteToolCall("update_draft", { task_id: "lease-1" }),
          cassetteAssistant("已按验收改过租期。"),
        );
        const result = await h.runTurn("请起草这份租赁合同，继续不澄清");
        expect(drafts).toEqual(["draft", "update"]);
        expect(result.turn.status).toBe("completed");
        expect(result.reply).toContain("已按验收改过租期");
        expect(h.request(1).contains(SAME_TURN_VERIFY_USER_PREFIX)).toBe(true);
        expect(h.request(1).contains("lease.term_cap")).toBe(true);
      },
    );
  });

  it("soft budget while verify is red pauses instead of completing", async () => {
    await withTestLawMind(
      (b) =>
        b.withMaxToolCalls(1).withToolExecute("apply_surgical_edits", async () => ({
          ok: true,
          data: { redlinePending: 0, craftCheck: null, taskId: "t1" },
        })),
      async (h) => {
        h.enqueue(
          cassetteToolCall("apply_surgical_edits", { edits: [{ find: "甲", replace: "甲" }] }),
        );
        h.enqueue(cassetteAssistant("已完成。"));
        const result = await h.runTurn("请按词修订这份合同，继续不澄清");
        expect(result.turn.status).toBe("paused");
        expect(result.reply).toContain(SAME_TURN_VERIFY_USER_PREFIX);
        expect(result.reply).not.toMatch(/^已完成/);
      },
    );
  });
});

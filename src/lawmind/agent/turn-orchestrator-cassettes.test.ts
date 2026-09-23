import fs from "node:fs";
import path from "node:path";
/**
 * Orchestrator admission cassettes.
 *
 * Fake model (JSON/SSE). Real runTurn, real tool names, real gates.
 * Assert the next request body / executed tools / turn status — not prompt copy.
 *
 * Required when changing: turn-orchestrator*, intake/clarification, compact,
 * steer, playbook tool locks, permission/approval pipeline.
 */
import { describe, expect, it } from "vitest";
import { buildRoleDirectiveFromProfile } from "../assistants/store.js";
import {
  DELIVERY_MARKER_CHAT_QA,
  DELIVERY_MARKER_OPINION_MEMO,
} from "../intent/delivery-intent.js";
import { INTENT_HYPOTHESIS_HEADING, UNDERSTAND_FIRST_HEADING } from "../intent/understand-first.js";
import { WORKING_BRIEF_HEADING } from "../intent/working-brief.js";
import { buildAgentFleetSummary } from "../platform/build-agent-fleet.js";
import { FOLDER_EXPLORE_GATE_ERROR } from "../runtime/tool-pipeline.js";
import { COMPACT_REINJECTION_MARKER } from "./compact-insert.js";
import { CONTEXT_DEFERRAL_BOUNCE_MARKER } from "./context-deferral.js";
import { MAIL_CONTRACT_FAST_PATH_DENIED_HINT } from "./mail-contract-fast-path.js";
import { CARRYOVER_SEED_MARKER, forkSessionWithCarryover } from "./session-carryover.js";
import { formatSteerUserMessage } from "./session-context-steer.js";
import { loadSession, saveSession } from "./session.js";
import {
  cassetteAssistant,
  cassetteHttpError,
  cassetteToolCall,
  cassetteToolCalls,
  withTestLawMind,
} from "./testkit/index.js";
import { isSessionTurnLive } from "./turn-interrupt.js";
import { clearTurnLifecycleHooks, registerTurnLifecycleHook } from "./turn-lifecycle-hooks.js";
import type { AgentMessage } from "./types.js";

const FAST_LANE = [
  "【交办】5 分钟合同审查",
  "交付物类型：合同审查意见",
  "- 合同/材料说明：nda.docx",
  "- 审查重点：付款与违约",
  "- 己方立场：委托方（保护我方利益）",
  "审查深度：快速。",
].join("\n");

const WORD_REVISION = [
  "【用户在 LawMind 文件页将下列路径标为“本回合重点”（路径引用，需助手读取）】",
  "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
  "",
  "修改合同",
].join("\n");

/** Word 插件「审这份」的固定指令（由 `word-addin/auto-run.ts` 生成，逐字同形即可）。 */
const WORD_ADDIN_REDLINE = [
  "【Word 改稿】",
  "matterId=`甲案`",
  "默认 contract_edit_baseline_path=`/Users/shl/Desktop/某案/技术服务合同.docx`",
  "",
  "## 审查要求",
  "审查这份合同：出最短锚点修订轨，逐处说明依据。",
  "",
  "## 执行约束（Word 就地改稿）",
  "- 基线就是上面这个本机文件（绝对路径已给）。",
  "- 不要再问「审查重点」「己方立场」。",
  "- 推荐路径：`apply_surgical_edits` → `render_tracked_draft`。",
  "- 禁止 `render_document` 重建原件，禁止 `prepare_outbound_mail` / `send_email`。",
].join("\n");

const CITATION = "《民法典》第577条";

function ts(): string {
  return new Date().toISOString();
}

function toolErrors(result: { turn: { messages: AgentMessage[] } }): string {
  return result.turn.messages
    .flatMap((m) => m.toolCallResponses ?? [])
    .map((r) => r.result.error ?? "")
    .join("\n");
}

/**
 * 送出自检：请求体里不能有落在 tool_calls 组外的 tool 消息。
 * DeepSeek / OpenAI 兼容接口遇到这种历史整请求 400。
 */
function orphanToolCallIds(
  messages: Array<{ role?: string; tool_call_id?: string; tool_calls?: Array<{ id?: string }> }>,
): string[] {
  const orphans: string[] = [];
  let open: Set<string> | null = null;
  for (const msg of messages) {
    if (msg.role === "tool") {
      const id = msg.tool_call_id ?? "";
      if (!open || !open.has(id)) {
        orphans.push(id);
      }
      open?.delete(id);
      continue;
    }
    open = msg.tool_calls?.length ? new Set(msg.tool_calls.map((tc) => tc.id ?? "")) : null;
  }
  return orphans;
}

describe("turn-orchestrator cassettes (admission)", () => {
  it("fast-lane: next request stays unlocked with the 5-minute craft; search_statute executes", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteToolCall("search_statute"), cassetteAssistant("已处理。"));
        await h.runTurn(FAST_LANE);
        expect(h.request(0).contains("合同审查 · 快车道")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("list_more_tools")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("search_statute")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("draft_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("calculate")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("search_case_law")).toBe(true);
        expect(h.spy?.log.executedNames()).toContain("search_statute");
      },
    );
  });

  it("fast-lane: update_plan executes and the next request carries the checklist", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(
          cassetteToolCall("update_plan", {
            plan: [
              { step: "读钉选合同", status: "in_progress" },
              { step: "给出修订建议", status: "pending" },
            ],
          }),
          cassetteAssistant("先通读合同。"),
        );
        await h.runTurn(FAST_LANE);
        expect(h.spy?.log.calls.find((call) => call.name === "update_plan")?.result.ok).toBe(true);
        expect(h.request(1).contains("<!--lm-ws:plan-->")).toBe(true);
        expect(h.request(1).contains("读钉选合同")).toBe(true);
      },
    );
  });

  it("mail-contract: search_statute stays available; render_document is denied", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteToolCall("search_statute"), cassetteAssistant("已处理。"));
        await h.runTurn(
          [
            "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
            "默认 contract_edit_baseline_path=`cases/m/a.docx`",
            "建议回复收件人：opp@firm.cn",
          ].join("\n"),
        );
        const advertised = h.request(0).advertisedToolNames();
        expect(advertised).toContain("prepare_outbound_mail");
        expect(advertised).toContain("apply_surgical_edits");
        expect(advertised).toContain("search_statute");
        expect(advertised).toContain("search_case_law");
        expect(advertised).toContain("calculate");
        expect(advertised).toContain("list_more_tools");
        expect(advertised).not.toContain("render_document");
        expect(advertised).not.toContain("send_email");
        expect(h.spy?.log.executedNames()).toContain("search_statute");
      },
    );
  });

  it("mail-contract: render_document is blocked if the model names it", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteToolCall("render_document"), cassetteAssistant("已处理。"));
        const result = await h.runTurn(
          [
            "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
            "默认 contract_edit_baseline_path=`cases/m/a.docx`",
            "建议回复收件人：opp@firm.cn",
          ].join("\n"),
        );
        expect(h.request(0).hasAdvertisedTool("render_document")).toBe(false);
        expect(h.spy?.log.executedNames()).not.toContain("render_document");
        expect(toolErrors(result)).toContain("render_document");
        expect(toolErrors(result)).toContain(MAIL_CONTRACT_FAST_PATH_DENIED_HINT.slice(0, 12));
      },
    );
  });

  it("export-lint-gate: render_document blocked on mechanical lint; bounce lands in the next request", async () => {
    const { persistDraft } = await import("../drafts/index.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        persistDraft(h.workspaceDir, {
          taskId: "t-lint-gate",
          title: "房屋租赁合同审查意见",
          summary: "s",
          sections: [
            {
              heading: "一、合同本体",
              body: "房屋租赁合同。租赁期限 25 年，租金按月支付。双方按约履行各自义务。",
              citations: [],
            },
          ],
          reviewStatus: "approved",
          reviewNotes: [],
          output: "docx",
          templateId: "word/legal-memo-default",
          deliverableType: "contract.review",
          createdAt: ts(),
        });
        h.enqueue(
          cassetteToolCall("render_document", {
            task_id: "t-lint-gate",
            bypass_acceptance_gate: true,
          }),
          // Guardian 独立审稿先跑（消耗一轮 cassette）：pass 不豁免机械核对。
          cassetteAssistant(JSON.stringify({ verdict: "pass", gaps: [] })),
          cassetteAssistant("已按缺口收窄改稿，重新导出。"),
        );
        const result = await h.runTurn("导出这份审查意见");
        const render = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "render_document");
        expect(render?.result.ok).toBe(false);
        expect(toolErrors(result)).toContain("lease.term_cap");
        // 验收缺口回灌：下一轮请求体带着机械核对缺口，而不是假装已完成。
        const next = h.request(2);
        expect(next.contains("lease.term_cap")).toBe(true);
        expect(next.contains("同一回合验收未过")).toBe(true);
      },
    );
  });

  it("word-addin auto-run instruction: redline tools advertised, outbound/rebuild blocked", async () => {
    // Word 插件「审这份」的固定指令（真机由 auto-run.ts 生成）走的是 word-revision 锁；
    // 这条 cassette 锁住它对工具表的影响：改稿链在、外发与模板重建不在。
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteToolCall("send_email"), cassetteAssistant("已处理。"));
        const result = await h.runTurn(WORD_ADDIN_REDLINE);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_tracked_draft")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_draft")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_document")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("prepare_outbound_mail")).toBe(false);
        expect(toolErrors(result)).toContain("send_email");
      },
    );
  });

  it("word-revision lock: prepare_outbound_mail is not advertised and is blocked if the model names it", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteToolCall("prepare_outbound_mail"), cassetteAssistant("已处理。"));
        const result = await h.runTurn(WORD_REVISION);
        expect(h.request(0).hasAdvertisedTool("prepare_outbound_mail")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_tracked_draft")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_plan")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("search_statute")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("list_more_tools")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_document")).toBe(false);
        expect(h.spy?.log.executedNames()).not.toContain("prepare_outbound_mail");
        expect(toolErrors(result)).toContain("prepare_outbound_mail");
      },
    );
  });

  it("file-page 用户将 chrome + 审查 does not lock write tools", async () => {
    const instruction = [
      "【用户将下列路径标为“本回合重点”；其中 1 个小文本已嵌入正文，其余为路径引用】",
      "- [工作区 · 已嵌入正文] `采购合同摘录.txt`",
      "",
      "请审查这份采购合同",
    ].join("\n");
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn(instruction);
        expect(h.request(0).contains(instruction)).toBe(true);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("draft_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_plan")).toBe(true);
      },
    );
  });

  it("readonly: write_document is not advertised; adversarial write is hard-blocked", async () => {
    await withTestLawMind(
      (b) => b.withPermissionMode("readonly"),
      async (h) => {
        h.enqueue(cassetteToolCall("write_document"), cassetteAssistant("已处理。"));
        const result = await h.runTurn("继续不澄清。请只读分析材料。");
        expect(h.request(0).hasAdvertisedTool("write_document")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("analyze_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_plan")).toBe(true);
        expect(h.spy?.log.executedNames()).not.toContain("write_document");
        expect(toolErrors(result)).toMatch(/只读|write_document/);
        expect(
          result.turn.gateDecisions?.some(
            (g) => g.gate === "dangerous_tool_gate" && g.decision === "block",
          ),
        ).toBe(true);
      },
    );
  });

  it("intake hard-gate: demand letter does not call the model until the lawyer escapes", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const first = await h.runTurn("请写一份律师函催款");
        expect(first.turn.status).toBe("awaiting_clarification");
        expect(h.requests).toHaveLength(0);
        expect(first.turn.gateDecisions?.some((g) => g.gate === "intake_gate")).toBe(true);

        h.enqueue(cassetteAssistant("按补充继续催款函。"));
        const second = await h.runTurn("直接做，别再问了。收件人甲公司。");
        expect(second.turn.status).toBe("completed");
        expect(h.requests).toHaveLength(1);
        expect(h.request(0).contains("直接做")).toBe(true);
      },
    );
  });

  it("tool-returned clarification: next request contains the draft tool result, turn pauses", async () => {
    await withTestLawMind(
      (b) =>
        b.withToolExecute("draft_document", async () => ({
          ok: true,
          data: {
            title: "房屋租赁合同",
            deliveryReadiness: "draft_with_placeholders",
            clarificationQuestions: [
              { key: "rent_and_deposit", question: "请补充租金、押金和支付周期。" },
            ],
          },
        })),
      async (h) => {
        h.enqueue(
          cassetteToolCall("draft_document"),
          cassetteAssistant("我已经先生成了一份正式草稿。"),
        );
        const result = await h.runTurn("请起草一份房屋租赁合同，继续不澄清");
        expect(result.turn.status).toBe("awaiting_clarification");
        expect(h.requests.length).toBeGreaterThanOrEqual(2);
        expect(
          h.request(1).contains("rent_and_deposit") || h.request(1).contains("draft_document"),
        ).toBe(true);
        expect(h.spy?.log.executedNames()).toContain("draft_document");
      },
    );
  });

  it("compact: dropped statute citation and 红线重注 appear in the next request body", async () => {
    await withTestLawMind(
      (b) => b.withMaxHistory(8),
      async (h) => {
        const history: AgentMessage[] = [{ role: "system", content: "sys", timestamp: ts() }];
        history.push(
          { role: "user", content: "请核对违约责任依据", timestamp: ts() },
          {
            role: "assistant",
            content: "",
            timestamp: ts(),
            toolCalls: [{ id: "c-statute", name: "search_statute", arguments: { q: "违约" } }],
          },
          {
            role: "tool",
            content: JSON.stringify({
              ok: true,
              data: { hits: [`依据 ${CITATION}，当事人一方不履行合同义务。`] },
            }),
            timestamp: ts(),
            toolCallResponses: [
              {
                toolCallId: "c-statute",
                name: "search_statute",
                result: {
                  ok: true,
                  data: { hits: [`依据 ${CITATION}，当事人一方不履行合同义务。`] },
                },
              },
            ],
          },
          { role: "assistant", content: `已定位 ${CITATION}。`, timestamp: ts() },
        );
        for (let i = 0; i < 16; i += 1) {
          history.push(
            { role: "user", content: `填充轮 ${i}：继续讨论付款节奏`, timestamp: ts() },
            { role: "assistant", content: `填充答 ${i}：可分期。`, timestamp: ts() },
          );
        }
        const seeded = h.seedHistory(history, { matterId: "m-cite" });
        expect(seeded.conversationHistory.length).toBeGreaterThan(20);

        h.enqueue(cassetteAssistant("压缩后仍按已引用法条作答。"));
        const result = await h.runTurn("继续不澄清。请根据此前法条写结论。", {
          matterId: "m-cite",
        });
        expect(result.turn.status).toBe("completed");
        const req = h.request(0);
        expect(req.messageCount()).toBeLessThan(seeded.conversationHistory.length + 3);
        expect(req.contains(CITATION)).toBe(true);
        expect(req.contains(COMPACT_REINJECTION_MARKER)).toBe(true);
        expect(req.contains("压缩前引用") || req.contains("压缩前对话蒸馏")).toBe(true);
      },
    );
  });

  it("context: mid-turn compact rewrites history at the tool-round boundary and keeps running", async () => {
    await withTestLawMind(
      (b) => b.withMaxHistory(8),
      async (h) => {
        // 只把「回合内整理」的触发线压到很低：本轮断言的是机制（边界压缩 + 续跑），
        // 不依赖系统提示词体积 —— 第 2 轮必然越线。
        fs.writeFileSync(
          path.join(h.workspaceDir, "lawmind.policy.json"),
          `${JSON.stringify({ schemaVersion: 1, context: { midTurnCompactTriggerRatio: 0.02 } })}\n`,
          "utf8",
        );
        const history: AgentMessage[] = [{ role: "system", content: "sys", timestamp: ts() }];
        for (let i = 0; i < 10; i += 1) {
          history.push(
            { role: "user", content: `历史轮 ${i}：继续讨论付款节奏`, timestamp: ts() },
            { role: "assistant", content: `历史答 ${i}：可分期。`, timestamp: ts() },
          );
        }
        const seeded = h.seedHistory(history, { matterId: "m-midturn" });
        expect(seeded.conversationHistory.length).toBeGreaterThan(20);

        h.enqueue(
          cassetteToolCall("search_statute", { q: "违约" }),
          cassetteAssistant("已按检索结果继续完成交付。"),
        );
        const boundaries: Array<{ midTurn?: boolean; roundIndex?: number }> = [];
        const result = await h.runTurn("继续不澄清。根据此前依据写结论。", {
          matterId: "m-midturn",
          onEvent: (ev) => {
            if (ev.type === "compact_boundary") {
              boundaries.push({ midTurn: ev.midTurn, roundIndex: ev.roundIndex });
            }
          },
        });

        expect(result.turn.status).toBe("completed");
        expect(result.reply).toContain("继续完成交付");
        // 回合开始那次压缩不带 midTurn；工具轮边界这次必须带，且落在第 2 轮。
        expect(boundaries.map((b) => b.midTurn === true)).toEqual([false, true]);
        expect(boundaries[1]?.roundIndex).toBe(2);
        expect(h.session()?.lastCompactBoundary?.midTurn).toBe(true);
        // 压缩后接着跑完，而不是停在这一轮；送出的历史仍是可发送的配对态。
        expect(h.requests.length).toBe(2);
        expect(orphanToolCallIds(h.request(1).messages())).toEqual([]);
      },
    );
  });

  it("context: a budget-deferral reply is bounced back and never becomes the turn's answer", async () => {
    const DEFERRAL_REPLY =
      "说明：本轮上下文预算已接近上限，若需我起草或修改具体条款（竞业限制解除条款、三方义务分配），请另开一轮并告知协议主体结构，我会直接落到 Word 稿。";
    await withTestLawMind(
      (b) => b.withMaxHistory(8),
      async (h) => {
        h.seedHistory([{ role: "system", content: "sys", timestamp: ts() }], {
          matterId: "m-defer",
        });
        h.enqueue(
          cassetteToolCall("search_statute", { q: "竞业限制" }),
          cassetteAssistant(DEFERRAL_REPLY),
          cassetteAssistant("已按检索结果写完解除条款与三方义务分配，交付见在办。"),
        );
        const bounces: Array<{ bounceCount: number; roundIndex: number }> = [];
        const result = await h.runTurn("起草竞业限制解除条款与三方义务分配。", {
          matterId: "m-defer",
          onEvent: (ev) => {
            if (ev.type === "context_deferral_bounce") {
              bounces.push({ bounceCount: ev.bounceCount, roundIndex: ev.roundIndex });
            }
          },
        });

        expect(result.turn.status).toBe("completed");
        expect(result.reply).toContain("已按检索结果写完");
        expect(result.reply).not.toContain("另开一轮");
        expect(bounces).toEqual([{ bounceCount: 1, roundIndex: 2 }]);
        // 反弹消息进下一轮采样（模型看得见），律师气泡看不见。
        expect(h.requests.length).toBe(3);
        expect(h.request(2).contains(CONTEXT_DEFERRAL_BOUNCE_MARKER)).toBe(true);
        const visible = (h.session()?.conversationHistory ?? []).filter(
          (m) => m.hiddenFromLawyer !== true && m.role !== "system",
        );
        expect(visible.some((m) => (m.content ?? "").includes("另开一轮"))).toBe(false);
        // 反弹消息只服务下一轮采样：收口后不再留在历史里。
        expect(
          (h.session()?.conversationHistory ?? []).some((m) =>
            (m.content ?? "").startsWith(CONTEXT_DEFERRAL_BOUNCE_MARKER),
          ),
        ).toBe(false);
      },
    );
  });

  it("carryover: forked session sends the seed + migrated clarification keys in its first request", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const now = new Date().toISOString();
        const seeded = h.seedHistory(
          [
            { role: "system", content: "sys", timestamp: now },
            {
              role: "user",
              content: "起草竞业限制解除条款，依据《劳动合同法》第23条。",
              timestamp: now,
            },
            { role: "assistant", content: `已定位 ${CITATION}。`, timestamp: now },
          ],
          { matterId: "m-carry" },
        );
        // 源会话仍在硬澄清态：迁移丢了就等于静默放开起草门禁。
        seeded.pendingClarificationKeys = ["竞业限制补偿标准"];
        saveSession(h.workspaceDir, seeded);

        const forked = await forkSessionWithCarryover({
          workspaceDir: h.workspaceDir,
          sourceSessionId: seeded.sessionId,
        });
        expect(forked.ok).toBe(true);
        if (!forked.ok) {
          return;
        }

        h.enqueue(cassetteAssistant("继续写解除条款。"));
        await h.runTurn("继续不澄清。请根据此前依据写结论。", {
          sessionId: forked.session.sessionId,
          matterId: "m-carry",
        });

        // 第一次请求就带着续接事实：状态头 + 蒸馏里的法条锚点 + 待澄清键。
        expect(h.request(0).contains(CARRYOVER_SEED_MARKER)).toBe(true);
        expect(h.request(0).contains(CITATION)).toBe(true);
        expect(h.request(0).contains("待澄清键")).toBe(true);
        expect(h.request(0).contains("竞业限制补偿标准")).toBe(true);
        expect(h.request(0).contains(`sessions/${seeded.sessionId}.json`)).toBe(true);
      },
    );
  });

  it("compact: a legacy orphan tool result heals so the next request is sendable", async () => {
    await withTestLawMind(
      (b) => b.withMaxHistory(8),
      async (h) => {
        h.seedHistory(
          [
            { role: "system", content: "sys", timestamp: ts() },
            { role: "user", content: "先看看材料", timestamp: ts() },
            // 旧版本压缩把 assistant(tool_calls) 整个丢掉，只留下这条孤立结果：
            // 客户落盘会话就是这个形状，DeepSeek 每轮直接 400。
            {
              role: "tool",
              content: JSON.stringify({ ok: true, data: { hits: ["孤立结果"] } }),
              timestamp: ts(),
              toolCallResponses: [
                { toolCallId: "c-lost", name: "search_workspace", result: { ok: true } },
              ],
            },
            { role: "assistant", content: "已看过材料。", timestamp: ts() },
          ],
          { matterId: "m-orphan" },
        );
        h.enqueue(cassetteAssistant("继续。"));
        const result = await h.runTurn("继续不澄清。请说明下一步。", { matterId: "m-orphan" });
        expect(result.turn.status).toBe("completed");
        expect(orphanToolCallIds(h.request(0).messages())).toEqual([]);
        expect(h.request(0).contains("孤立结果")).toBe(false);
      },
    );
  });

  it("compact: multi-tool batch cut by compaction is never sent half-paired", async () => {
    await withTestLawMind(
      (b) => b.withMaxHistory(8),
      async (h) => {
        const history: AgentMessage[] = [{ role: "system", content: "sys", timestamp: ts() }];
        for (let i = 0; i < 12; i += 1) {
          history.push(
            { role: "user", content: `填充轮 ${i}：继续讨论付款节奏`, timestamp: ts() },
            { role: "assistant", content: `填充答 ${i}：可分期。`, timestamp: ts() },
          );
        }
        const toolIds = ["x1", "x2", "x3"];
        history.push(
          { role: "user", content: "一次查三份依据", timestamp: ts() },
          {
            role: "assistant",
            content: "",
            timestamp: ts(),
            toolCalls: toolIds.map((id) => ({ id, name: "search_statute", arguments: {} })),
          },
          ...toolIds.map((id) => ({
            role: "tool" as const,
            content: JSON.stringify({ ok: true, data: { hits: [`依据 ${CITATION}`] } }),
            timestamp: ts(),
            toolCallResponses: [
              {
                toolCallId: id,
                name: "search_statute",
                result: { ok: true, data: { hits: [`依据 ${CITATION}`] } },
              },
            ],
          })),
        );
        const seeded = h.seedHistory(history, { matterId: "m-group" });
        h.enqueue(cassetteAssistant("压缩后继续。"));
        const result = await h.runTurn("继续不澄清。请根据此前依据写结论。", {
          matterId: "m-group",
        });
        expect(result.turn.status).toBe("completed");
        const req = h.request(0);
        expect(req.messageCount()).toBeLessThan(seeded.conversationHistory.length + 2);
        // 切点无论落在这一批的哪一条，请求体都不得出现孤立 tool。
        expect(orphanToolCallIds(req.messages())).toEqual([]);
      },
    );
  });

  it("self-heal: a pairing 400 repairs history and resends once, off the retry budget", async () => {
    await withTestLawMind(
      (b) => b.withMaxHistory(8),
      async (h) => {
        h.seedHistory(
          [
            { role: "system", content: "sys", timestamp: ts() },
            { role: "user", content: "先看材料", timestamp: ts() },
            {
              role: "tool",
              content: JSON.stringify({ ok: true }),
              timestamp: ts(),
              toolCallResponses: [
                { toolCallId: "c-lost", name: "search_workspace", result: { ok: true } },
              ],
            },
            { role: "assistant", content: "已看过。", timestamp: ts() },
          ],
          { matterId: "m-heal" },
        );
        h.enqueue(
          cassetteHttpError(
            400,
            JSON.stringify({
              error: {
                message:
                  "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
                type: "invalid_request_error",
                param: null,
                code: "invalid_request_error",
              },
            }),
          ),
          cassetteAssistant("已修复并继续。"),
        );
        const result = await h.runTurn("继续不澄清。请说明下一步。", { matterId: "m-heal" });
        expect(result.turn.status).toBe("completed");
        // 恰好两次：一次被拒 + 一次修复后重发（不占用普通 retry 预算）。
        expect(h.requests).toHaveLength(2);
        expect(orphanToolCallIds(h.request(1).messages())).toEqual([]);
      },
    );
  });

  it("a non-pairing 400 is not silently retried as if repairable", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.seedHistory([{ role: "system", content: "sys", timestamp: ts() }]);
        h.enqueue(
          cassetteHttpError(
            400,
            JSON.stringify({
              error: { message: "Invalid temperature", type: "invalid_request_error" },
            }),
          ),
          cassetteAssistant("不应被消费。"),
        );
        const result = await h.runTurn("继续不澄清。请说明下一步。");
        expect(result.turn.status).toBe("error");
        expect(h.requests).toHaveLength(1);
        expect(h.requests[0]?.messages().length).toBeGreaterThan(0);
      },
    );
  });

  it("steer: mid-turn note is in the next model request, not a new session", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.seedHistory([]);
        const steer = "不要写结论，先对责任上限";
        h.onModelRequest((req) => {
          if (req.index === 0) {
            h.queueSteer(steer);
          }
        });
        h.enqueue(cassetteToolCall("analyze_document"), cassetteAssistant("已按指示改责任上限。"));
        const result = await h.runTurn("继续不澄清。请审查违约金条款。");
        expect(result.turn.status).toBe("completed");
        expect(h.requests).toHaveLength(2);
        expect(h.request(0).contains("【律师中途指示】")).toBe(false);
        expect(h.request(1).contains(formatSteerUserMessage([steer]))).toBe(true);
        expect(h.request(1).contains(steer)).toBe(true);
        expect(h.spy?.log.executedNames()).toContain("analyze_document");
      },
    );
  });

  it("approval: send_email does not execute; turn awaits 拍板; no extra model round", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(
          cassetteToolCall("send_email", {
            matter_id: "m-mail",
            to: "a@example.com",
            subject: "函",
            body: "正文",
          }),
          cassetteAssistant("不该再采样。"),
        );
        const result = await h.runTurn("继续不澄清。把这封函发出去。", { matterId: "m-mail" });
        expect(result.turn.status).toBe("awaiting_approval");
        expect(h.spy?.log.executedNames()).not.toContain("send_email");
        expect(h.requests).toHaveLength(1);
        expect(h.remainingRounds()).toBe(1);
        expect(result.turn.pendingToolApproval?.toolName).toBe("send_email");
      },
    );
  });

  it("update_plan: next request carries world-state checklist; history is a receipt; completed list drops on a new instruction", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const plan = [
          { step: "读钉选合同", status: "in_progress" },
          { step: "标风险条款", status: "pending" },
          { step: "给出修订建议", status: "pending" },
        ];
        h.enqueue(cassetteToolCall("update_plan", { plan }), cassetteAssistant("先通读再标风险。"));
        const first = await h.runTurn("继续不澄清。帮我审这份合同。", {
          onEvent: () => undefined,
        });
        expect(h.request(0).hasAdvertisedTool("update_plan")).toBe(true);
        expect(h.spy?.log.executedNames()).toContain("update_plan");
        expect(h.spy?.log.calls.find((call) => call.name === "update_plan")?.result.ok).toBe(true);
        expect(h.requests).toHaveLength(2);
        expect(h.request(1).contains("<!--lm-ws:plan-->")).toBe(true);
        expect(h.request(1).contains("<turn_plan>")).toBe(true);
        expect(h.request(1).contains("读钉选合同")).toBe(true);
        const toolContent = h
          .request(1)
          .messages()
          .filter((m) => m.role === "tool")
          .map((m) => m.content ?? "")
          .join("\n");
        expect(toolContent).toContain("清单已更新");
        expect(toolContent).not.toContain("给出修订建议");
        expect(h.session()?.turnPlan?.items).toHaveLength(3);
        expect(first.events.some((event) => event.type === "plan_update")).toBe(true);
        expect(
          first.events.some(
            (event) => event.type === "tool_call_start" && event.toolName === "update_plan",
          ),
        ).toBe(false);

        h.enqueue(
          cassetteToolCall("update_plan", {
            plan: [
              { step: "读完", status: "completed" },
              { step: "写完", status: "completed" },
            ],
          }),
          cassetteAssistant("本轮步骤已完成。"),
        );
        await h.runTurn("继续不澄清。把审查收口。");
        expect(h.session()?.turnPlan?.items.every((item) => item.status === "completed")).toBe(
          true,
        );

        h.enqueue(cassetteAssistant("开始看另一份。"));
        await h.runTurn("继续不澄清。帮我再看另一份合同。");
        expect(h.request(-1).contains("<!--lm-ws:plan-->")).toBe(false);
        expect(h.session()?.turnPlan).toBeUndefined();
      },
    );
  });

  it("web_search is not advertised on legal turns; public-web facts skip the model", async () => {
    await withTestLawMind(
      (b) => b.withAllowWebSearch(true),
      async (h) => {
        h.enqueue(cassetteAssistant("未检索公开网页。"));
        await h.runTurn("继续不澄清。今天开庭日期怎么安排？");
        expect(h.request(0).hasAdvertisedTool("web_search")).toBe(false);
      },
    );
    await withTestLawMind(
      (b) => b.withAllowWebSearch(true),
      async (h) => {
        const result = await h.runTurn("继续不澄清。查一下2026年新说唱总冠军");
        expect(h.requests).toHaveLength(0);
        expect(h.spy?.log.executedNames()).toContain("web_search");
        expect(result.reply).toMatch(/联网检索|公开网页|不会猜/);
      },
    );
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const result = await h.runTurn("继续不澄清。查一下2026年新说唱总冠军");
        expect(h.requests).toHaveLength(0);
        expect(h.spy?.log.executedNames() ?? []).not.toContain("web_search");
        expect(result.reply).toContain("联网");
      },
    );
  });

  it("turn_context is sample-time; CASE overflow is not persisted into system history", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const matterId = "m-ctx";
        fs.mkdirSync(path.join(h.workspaceDir, "cases", matterId), { recursive: true });
        fs.writeFileSync(
          path.join(h.workspaceDir, "cases", matterId, "CASE.md"),
          `# 案\n\n## 1. 基本信息\n\n- 当事人：甲\n\n${"争议事实。".repeat(400)}`,
          "utf8",
        );
        h.enqueue(cassetteAssistant("已按案件索引作答。"));
        await h.runTurn("继续不澄清。请审查合同违约责任条款。", { matterId });
        const req = h.request(0);
        expect(req.systemText()).toContain("<!--lm-ws:permission-->");
        expect(req.systemText()).not.toContain(`cases/${matterId}/CASE.md`);
        expect(req.userTexts().some((text) => text.includes("<turn_context>"))).toBe(true);
        expect(req.userTexts().some((text) => text.includes(`cases/${matterId}/CASE.md`))).toBe(
          true,
        );
        const history = h.session()?.conversationHistory ?? [];
        expect(history[0]?.role).toBe("system");
        expect(history.some((msg) => (msg.content ?? "").includes("<turn_context>"))).toBe(false);
        expect(
          history.some((msg) => (msg.content ?? "").includes(`cases/${matterId}/CASE.md`)),
        ).toBe(false);
      },
    );
  });

  it("free turn advertises list_dir so a brought-in folder can be walked", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已看到目录。"));
        await h.runTurn("请阅读这个文件夹", {
          contextPins: [
            {
              pinKind: "file",
              root: "workspace",
              relPath: "materials",
              kind: "directory",
            },
          ],
        });
        const advertised = h.request(0).advertisedToolNames();
        expect(advertised).toContain("list_dir");
        expect(advertised).toContain("analyze_document");
      },
    );
  });

  it("fast-lane does not freeze list_dir away", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn(FAST_LANE);
        expect(h.request(0).contains("合同审查 · 快车道")).toBe(true);
        expect(h.request(0).advertisedToolNames()).toContain("list_dir");
      },
    );
  });

  it("implicit compile: 帮我看看 + 买卖合同.docx hypothesizes review without caging tools", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        const result = await h.runTurn("帮我看看", {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "买卖合同.docx",
              kind: "file",
            },
          ],
        });
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();
        expect(result.turn.status).not.toBe("error");
        expect(h.request(0).contains(INTENT_HYPOTHESIS_HEADING)).toBe(true);
        expect(h.request(0).contains("## 本轮 LawMind 能力：合同审查")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("render_tracked_draft")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("update_plan")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("explore_folder")).toBe(true);
      },
    );
  });

  it("implicit compile: 帮我看看 + 民事起诉状.docx hypothesizes litigation without Skill dump", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("帮我看看", {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "民事起诉状.docx",
              kind: "file",
            },
          ],
        });
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();
        expect(h.request(0).contains("## 本轮 LawMind 能力：诉讼文书")).toBe(false);
        expect(h.request(0).contains(INTENT_HYPOTHESIS_HEADING)).toBe(true);
      },
    );
  });

  it("word-revision on a complaint binds litigation.draft and keeps the Word tool lock", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("帮我改一下", {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "民事起诉状.docx",
              kind: "file",
            },
          ],
        });
        expect(h.session()?.lastBoundCapabilityId).toBe("litigation.draft");
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("prepare_outbound_mail")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("render_document")).toBe(false);
      },
    );
  });

  it("correction utterance clears lastBound so 继续 does not sticky-resume", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("帮我看看", {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "买卖合同.docx",
              kind: "file",
            },
          ],
        });
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();

        h.enqueue(cassetteAssistant("好的，已取消。"));
        await h.runTurn("不对");
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();

        h.enqueue(cassetteAssistant("请说明要办的事。"));
        await h.runTurn("继续");
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();
      },
    );
  });

  it("rejecting 合同审核 for 律师函 QA drops the old plan and does not cage 函件起草", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(
          cassetteToolCall("update_plan", {
            plan: [
              { step: "补读 MOU 第九条", status: "in_progress" },
              { step: "导出意见书 Word", status: "pending" },
            ],
          }),
          cassetteAssistant("先补读 MOU。"),
        );
        await h.runTurn("帮我看看", {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "买卖合同.docx",
              kind: "file",
            },
          ],
        });
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();
        expect(h.session()?.turnPlan?.items.some((item) => item.step.includes("MOU"))).toBe(true);

        h.enqueue(cassetteAssistant("先看文件夹里的律师函。"));
        await h.runTurn(
          "我要你做的不是合同审核，是根据【河南堃云顿数据科技有限公司】文件夹里的信息帮我看我起草的律师函内容是否有误",
        );
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();
        expect(h.session()?.turnPlan).toBeUndefined();
        const next = h.request(-1);
        expect(next.systemText()).not.toContain("补读 MOU 第九条");
        expect(next.contains(UNDERSTAND_FIRST_HEADING)).toBe(true);
        expect(next.contains(INTENT_HYPOTHESIS_HEADING)).toBe(true);
        expect(next.contains("letter.draft")).toBe(true);
        expect(next.contains("## 本轮 LawMind 能力：函件起草")).toBe(false);
        expect(next.contains("## 本轮 LawMind 能力：合同审查")).toBe(false);
        expect(next.hasAdvertisedTool("list_dir")).toBe(true);
        expect(next.hasAdvertisedTool("explore_folder")).toBe(true);
        expect(next.hasAdvertisedTool("apply_surgical_edits")).toBe(false);
        expect(next.hasAdvertisedTool("draft_document")).toBe(false);
        expect(next.hasAdvertisedTool("render_tracked_draft")).toBe(false);
        expect(next.hasAdvertisedTool("render_document")).toBe(false);
        expect(next.contains(WORKING_BRIEF_HEADING)).toBe(true);
        expect(next.contains("不要做")).toBe(true);
        expect(next.contains("合同审查")).toBe(true);
        expect(next.contains(DELIVERY_MARKER_CHAT_QA)).toBe(true);
      },
    );
  });

  it("keyword-only review does not cage the next request with a Skill dump", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("先确认本轮要审什么。"));
        await h.runTurn("请审查合同违约责任");
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();
        expect(h.request(0).contains(UNDERSTAND_FIRST_HEADING)).toBe(true);
        expect(h.request(0).contains(INTENT_HYPOTHESIS_HEADING)).toBe(true);
        expect(h.request(0).contains("## 本轮 LawMind 能力：合同审查")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("list_dir")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("read_skill")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("explore_folder")).toBe(true);
      },
    );
  });

  it("continue after keyword-only review does not dump Skill bodies", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("先确认本轮要审什么。"));
        await h.runTurn("请审查合同条款");
        h.enqueue(cassetteAssistant("继续核对违约条款。"));
        await h.runTurn("继续");
        expect(h.session()?.lastBoundCapabilityId).toBeUndefined();
        const next = h.request(-1);
        expect(next.contains("## 本轮 LawMind 能力：合同审查")).toBe(false);
      },
    );
  });

  it("working brief and explore_folder are on the 律师函 QA request; utterance is not rewritten", async () => {
    const instruction =
      "我要你做的不是合同审核，是根据【河南堃云顿数据科技有限公司】文件夹里的信息帮我看我起草的律师函内容是否有误";
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const folder = `${h.workspaceDir}/河南堃云顿数据科技有限公司`;
        fs.mkdirSync(folder);
        fs.writeFileSync(`${folder}/律师函.txt`, "关于催告支付服务费。", "utf8");
        h.enqueue(
          cassetteToolCall("update_plan", {
            plan: [
              { step: "探查文件夹", status: "in_progress" },
              { step: "核对律师函", status: "pending" },
            ],
            goal: "核对接律师函是否有误",
            not_goal: "合同审查、审阅痕迹稿",
            materials: "河南堃云顿数据科技有限公司 先 explore_folder",
            done: "指出具体错误并引用材料",
          }),
          cassetteToolCall("explore_folder", {
            goal: "根据文件夹核对接律师函是否有误",
            not_goal: "合同审查、审阅痕迹稿",
            path: "河南堃云顿数据科技有限公司",
          }),
          cassetteAssistant("函里催告事项需对照文件夹材料。"),
        );
        await h.runTurn(instruction);
        expect(h.request(0).contains(instruction)).toBe(true);
        expect(
          h
            .session()
            ?.conversationHistory.some((m) => m.role === "user" && m.content === instruction),
        ).toBe(true);
        expect(h.request(0).contains(WORKING_BRIEF_HEADING)).toBe(true);
        expect(h.request(0).hasAdvertisedTool("explore_folder")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("draft_document")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("draft_worker")).toBe(false);
        expect(h.session()?.turnPlan?.brief?.notGoal).toContain("合同审查");
        expect(h.request(0).contains(DELIVERY_MARKER_CHAT_QA)).toBe(true);
        expect(h.request(1).contains("<not_goal>")).toBe(true);
        expect(h.spy?.log.executedNames()).toContain("explore_folder");
        const explore = h.spy?.log.calls.find((c) => c.name === "explore_folder");
        expect(explore?.result.ok).toBe(true);
      },
    );
  });

  it("opinion memo sidecar: next request is unlocked review with the delivery marker, not Word lock", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("请根据这个合同去给我一些审查意见放到桌面，不要在源文件上修改", {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "采购合同.docx",
              kind: "file",
            },
          ],
        });
        expect(h.session()?.lastBoundCapabilityId).toBe("contract.review");
        expect(h.request(0).contains(DELIVERY_MARKER_OPINION_MEMO)).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("draft_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_tracked_draft")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("prepare_outbound_mail")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
      },
    );
  });

  it("read_skill is advertised and still listed after it executes", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(
          cassetteToolCall("read_skill", { skill_id: "contract-review-layers" }),
          cassetteAssistant("已处理。"),
        );
        await h.runTurn("请审查合同违约责任");
        expect(h.request(0).hasAdvertisedTool("read_skill")).toBe(true);
        expect(h.spy?.log.executedNames()).toContain("read_skill");
        expect(h.request(1).hasAdvertisedTool("read_skill")).toBe(true);
      },
    );
  });

  it("fast-lane with Word pin keeps surgical tools and does not stamp opinion-memo delivery", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn(FAST_LANE, {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "nda.docx",
              kind: "file",
            },
          ],
        });
        expect(h.request(0).contains(DELIVERY_MARKER_OPINION_MEMO)).toBe(false);
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_tracked_draft")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("draft_document")).toBe(true);
      },
    );
  });

  it("draft_worker is advertised on a multi-section draft and executes two parallel briefs", async () => {
    const instruction = "请根据买卖合同.docx 起草违约金条款和管辖条款";
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(
          cassetteToolCalls([
            {
              name: "draft_worker",
              arguments: {
                goal: "起草买卖合同违约金条款",
                not_goal: "不要写管辖、不要改原件",
                materials: "买卖合同.docx",
                section: "违约金",
              },
            },
            {
              name: "draft_worker",
              arguments: {
                goal: "起草买卖合同管辖条款",
                not_goal: "不要写违约金、不要改原件",
                materials: "买卖合同.docx",
                section: "管辖",
              },
            },
          ]),
          cassetteAssistant("两段草稿已汇总，请律师审阅。"),
        );
        await h.runTurn(instruction);
        expect(h.request(0).contains(instruction)).toBe(true);
        expect(h.request(0).hasAdvertisedTool("draft_worker")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("draft_document")).toBe(true);
        const executed = h.spy?.log.calls.filter((c) => c.name === "draft_worker") ?? [];
        expect(executed).toHaveLength(2);
        expect(executed.map((c) => String(c.args.section)).toSorted()).toEqual(["管辖", "违约金"]);
        expect(executed.every((c) => c.result.ok)).toBe(true);
        expect(h.request(1).hasAdvertisedTool("draft_worker")).toBe(true);
      },
    );
  });

  it("model-error: http failure closes the turn without throwing", async () => {
    const hooks: string[] = [];
    const off = registerTurnLifecycleHook((ev) => {
      hooks.push(ev.phase);
    });
    try {
      await withTestLawMind(
        (b) => b,
        async (h) => {
          h.enqueue(cassetteHttpError(400, '{"error":"upstream down"}'));
          const events: string[] = [];
          const result = await h.runTurn("继续不澄清。请审查违约金。", {
            onEvent: (ev) => {
              events.push(ev.type);
            },
          });
          expect(result.turn.status).toBe("error");
          expect(result.reply).toContain("模型调用失败");
          expect(events).toContain("model_error");
          expect(events).toContain("final");
          expect(hooks).toContain("model_error");
        },
      );
    } finally {
      off();
      clearTurnLifecycleHooks();
    }
  });

  it("compact-audit: boundary event carries firstKept and session audit fields", async () => {
    await withTestLawMind(
      (b) => b.withMaxHistory(6),
      async (h) => {
        const seeded = h.seedHistory(
          [
            { role: "system", content: "sys", timestamp: ts() },
            ...Array.from({ length: 20 }, (_, i) => ({
              role: (i % 2 === 0 ? "user" : "assistant") as AgentMessage["role"],
              content: i % 2 === 0 ? `律师问题 ${i}` : `助手回答 ${i} ${CITATION}`,
              timestamp: ts(),
            })),
          ],
          { matterId: "m-audit" },
        );
        expect(seeded.conversationHistory.length).toBeGreaterThan(10);
        const events: Array<Record<string, unknown>> = [];
        h.enqueue(cassetteAssistant("压缩后仍按已引用法条作答。"));
        const result = await h.runTurn("继续不澄清。请根据此前法条写结论。", {
          matterId: "m-audit",
          onEvent: (ev) => {
            if (ev.type === "compact_boundary") {
              events.push(ev as unknown as Record<string, unknown>);
            }
          },
        });
        expect(result.turn.status).toBe("completed");
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(typeof events[0]?.boundaryId).toBe("string");
        expect(h.session()?.lastCompactBoundary?.boundaryId).toBeTruthy();
      },
    );
  });

  it("tool-delta: disclosure growth emits hidden transcript note on next round", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.seedHistory([]);
        h.onModelRequest((req) => {
          if (req.index === 0) {
            const session = h.session();
            if (session) {
              session.disclosedToolNames = [...(session.disclosedToolNames ?? []), "web_search"];
            }
          }
        });
        h.enqueue(cassetteToolCall("analyze_document"), cassetteAssistant("已处理。"));
        const events: string[] = [];
        const result = await h.runTurn("继续不澄清。请审查违约金条款。", {
          onEvent: (ev) => {
            events.push(ev.type);
          },
        });
        expect(result.turn.status).toBe("completed");
        expect(h.requests.length).toBeGreaterThanOrEqual(2);
        if (events.includes("tool_delta")) {
          expect(h.request(1).contains("【工具声明变更】")).toBe(true);
        }
      },
    );
  });
  it("summons-fill-advertises-desk-write", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("按这份传票把开庭补上", {
          matterId: "m-summons",
          contextPins: [
            {
              pinKind: "file",
              root: "workspace",
              relPath: "开庭传票.pdf",
              kind: "file",
            },
          ],
        });
        expect(h.request(0).hasAdvertisedTool("extract_legal_events")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("apply_legal_events")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("list_more_tools")).toBe(true);
      },
    );
  });

  it("summons-fill-writes-deadline", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    const { listDeadlinesForMatter } = await import("../application/services/deadline-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, {
          matterId: "m-write",
          title: "传票案",
          matterKind: "litigation",
        });
        const summonsText =
          "传票：请于2026年10月12日9时到第三法庭开庭。案号（2026）京0105民初88号。";
        fs.mkdirSync(path.join(h.workspaceDir, "cases", "m-write", "materials"), {
          recursive: true,
        });
        const rel = "cases/m-write/materials/传票.txt";
        fs.writeFileSync(path.join(h.workspaceDir, rel), summonsText, "utf8");
        h.enqueue(
          cassetteToolCall("apply_legal_events", {
            events: [
              {
                eventKind: "hearing",
                title: "开庭",
                dueAt: "2026-10-12T01:00:00.000Z",
                notes: summonsText,
              },
            ],
          }),
          cassetteAssistant("已写入开庭。"),
        );
        const result = await h.runTurn("按这份传票把开庭补上", {
          matterId: "m-write",
          contextPins: [{ pinKind: "file", root: "workspace", relPath: rel, kind: "file" }],
        });
        const apply = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "apply_legal_events");
        expect(apply?.result.ok).toBe(true);
        const deadlines = listDeadlinesForMatter(h.workspaceDir, "m-write");
        expect(deadlines.some((d) => d.eventKind === "hearing" || d.title.includes("开庭"))).toBe(
          true,
        );
      },
    );
  });

  it("talk-fill-confirms-brief", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    const { loadIntakeBrief } = await import("../desk/intake-brief.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, { matterId: "m-talk", title: "谈话案" });
        const transcript = "客户希望解除合同并退回定金。已付定金未交货。";
        h.enqueue(
          cassetteToolCall("compile_intake_brief", { transcript }),
          cassetteToolCall("apply_intake_brief", {}),
          cassetteAssistant("谈话已写入。"),
        );
        await h.runTurn("把这段谈话整理进本案", { matterId: "m-talk" });
        expect(loadIntakeBrief(h.workspaceDir, "m-talk")?.confirmedAt).toBeTruthy();
      },
    );
  });

  it("folder-fill-advertises-host", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("按这个文件夹补卷宗", {
          matterId: "m-folder",
          contextPins: [
            {
              pinKind: "file",
              root: "workspace",
              relPath: "materials/证据包",
              kind: "directory",
            },
          ],
        });
        expect(h.request(0).hasAdvertisedTool("explore_folder")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("import_host_file")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_matter_profile")).toBe(true);
      },
    );
  });

  it("matter-switch-rebinds-session-and-receives-into-the-new-case", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, {
          matterId: "旧案",
          title: "旧案",
          matterKind: "litigation",
        });
        createMatterIfMissing(h.workspaceDir, {
          matterId: "新案",
          title: "新案",
          matterKind: "litigation",
        });
        fs.mkdirSync(path.join(h.workspaceDir, "待收材料"), { recursive: true });
        fs.writeFileSync(path.join(h.workspaceDir, "待收材料", "起诉状.txt"), "诉请", "utf8");
        // 会话已绑在旧案；律师随后在工作台新建「新案」并把对话切到新案。
        h.seedHistory([], { matterId: "旧案" });
        h.enqueue(
          cassetteToolCall("import_host_file", { path: "待收材料/起诉状.txt" }),
          cassetteAssistant("已收进本案。"),
        );
        const result = await h.runTurn("把待收材料这个文件夹收进本案", {
          matterId: "新案",
          contextPins: [
            { pinKind: "file", root: "workspace", relPath: "待收材料", kind: "directory" },
          ],
        });
        // 会话跟上本回合的案件，而不是钉在第一个案件上。
        expect(h.session()?.matterId).toBe("新案");
        const imported = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "import_host_file");
        expect(imported?.result.ok, JSON.stringify(imported?.result.error)).toBe(true);
        // 工具没显式给 matter_id：默认必须跟本回合的案子。
        expect(
          fs.existsSync(path.join(h.workspaceDir, "cases", "新案", "materials", "起诉状.txt")),
        ).toBe(true);
        expect(
          fs.existsSync(path.join(h.workspaceDir, "cases", "旧案", "materials", "起诉状.txt")),
        ).toBe(false);
      },
    );
  });

  it("stale-approval-resumes-in-the-card-s-matter-not-the-switched-one", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, {
          matterId: "甲案",
          title: "甲案",
          matterKind: "litigation",
        });
        createMatterIfMissing(h.workspaceDir, {
          matterId: "乙案",
          title: "乙案",
          matterKind: "litigation",
        });
        fs.mkdirSync(path.join(h.workspaceDir, "新材料"), { recursive: true });
        fs.writeFileSync(path.join(h.workspaceDir, "新材料", "起诉状.txt"), "诉请", "utf8");
        // 卡片在「甲案」开出来；等到律师点批准时，对话已经被切到「乙案」。
        const pending = h.seedHistory([], { matterId: "甲案" });
        pending.matterId = "乙案";
        pending.pendingRequiresAction = [
          {
            id: "ra-import",
            kind: "tool_approval",
            threadId: "甲案:turn-1:" + pending.sessionId,
            title: "待批准：收进本案",
            summary: "拟进行「收进本案」。请确认后再继续，或选择暂不办理。",
            matterId: "甲案",
            sessionId: pending.sessionId,
            taskId: "turn-1",
            toolName: "import_host_file",
            toolCallId: "call-1",
            toolArgs: { path: "新材料/起诉状.txt" },
            decisions: ["approve", "reject"],
            createdAt: new Date().toISOString(),
          },
        ];
        saveSession(h.workspaceDir, pending);
        h.enqueue(
          cassetteToolCall("import_host_file", { path: "新材料/起诉状.txt" }),
          cassetteAssistant("已收进甲案。"),
        );
        await h.resume({
          sessionId: pending.sessionId,
          actionId: "ra-import",
          decision: "approve",
        });
        // 授权的作用域是开卡时的甲案：不能被之后切走的会话案件改写。
        expect(
          fs.existsSync(path.join(h.workspaceDir, "cases", "甲案", "materials", "起诉状.txt")),
        ).toBe(true);
        expect(
          fs.existsSync(path.join(h.workspaceDir, "cases", "乙案", "materials", "起诉状.txt")),
        ).toBe(false);
        // 会话随之回到本次实际办理的案件，避免「写的和说的不是一案」。
        expect(h.session()?.matterId).toBe("甲案");
      },
    );
  });

  it("repair-mis-filed-materials: 对话里说放错了，模型当场跨案搬移并写穿", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, {
          matterId: "刘学江侵权案",
          title: "刘学江侵权案",
          matterKind: "litigation",
        });
        createMatterIfMissing(h.workspaceDir, {
          matterId: "岚江公司案",
          title: "岚江公司案",
          matterKind: "litigation",
        });
        // 事故形状：岚江公司的整包材料被收进了刘学江案的 materials/ 下。
        const wrongDir = path.join(
          h.workspaceDir,
          "cases",
          "刘学江侵权案",
          "materials",
          "岚江公司",
        );
        fs.mkdirSync(wrongDir, { recursive: true });
        fs.writeFileSync(path.join(wrongDir, "起诉状.txt"), "诉请", "utf8");
        h.enqueue(
          cassetteToolCall("relocate_matter_materials", {
            ops: [
              {
                from: "cases/刘学江侵权案/materials/岚江公司",
                to: "cases/岚江公司案/materials/岚江公司",
                reason: "放错案",
              },
            ],
            matter_id: "岚江公司案",
            goal: "把放错的材料挪回岚江公司案",
          }),
          cassetteAssistant("已把材料挪回岚江公司案。"),
        );
        const result = await h.runTurn("这些材料放错了，挪到岚江公司案去", {
          matterId: "岚江公司案",
        });
        // 第一轮就有这支笔（不靠关键词命中，desk 写包始终广告）。
        expect(h.request(0).hasAdvertisedTool("relocate_matter_materials")).toBe(true);
        const relocated = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "relocate_matter_materials");
        expect(relocated?.result.ok, JSON.stringify(relocated?.result.error)).toBe(true);
        expect(
          fs.existsSync(
            path.join(h.workspaceDir, "cases", "岚江公司案", "materials", "岚江公司", "起诉状.txt"),
          ),
        ).toBe(true);
        expect(
          fs.existsSync(
            path.join(h.workspaceDir, "cases", "刘学江侵权案", "materials", "岚江公司"),
          ),
        ).toBe(false);
      },
    );
  });

  it("repair-mis-filed-materials: 真相源文件搬不动（模型照搬也失败）", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, {
          matterId: "甲案",
          title: "甲案",
          matterKind: "litigation",
        });
        createMatterIfMissing(h.workspaceDir, {
          matterId: "乙案",
          title: "乙案",
          matterKind: "litigation",
        });
        h.enqueue(
          cassetteToolCall("relocate_matter_materials", {
            ops: [{ from: "cases/甲案/CASE.md", to: "cases/乙案/materials/CASE.md" }],
            matter_id: "乙案",
          }),
          cassetteAssistant("这一步办不了。"),
        );
        const result = await h.runTurn("把甲案的卷宗文件挪到乙案", { matterId: "乙案" });
        const relocated = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "relocate_matter_materials");
        expect(relocated?.result.ok).toBe(false);
        expect(fs.existsSync(path.join(h.workspaceDir, "cases", "甲案", "CASE.md"))).toBe(true);
        expect(
          fs.existsSync(path.join(h.workspaceDir, "cases", "乙案", "materials", "CASE.md")),
        ).toBe(false);
      },
    );
  });

  it("file-ops: 对话里要求改名，模型当场改名并写穿", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, {
          matterId: "甲案",
          title: "甲案",
          matterKind: "litigation",
        });
        const materials = path.join(h.workspaceDir, "cases", "甲案", "materials");
        fs.mkdirSync(materials, { recursive: true });
        fs.writeFileSync(path.join(materials, "扫描件001.pdf"), "pdf", "utf8");
        h.enqueue(
          cassetteToolCall("apply_file_ops", {
            ops: [
              {
                from: "cases/甲案/materials/扫描件001.pdf",
                to: "cases/甲案/materials/2026-03-01 民事起诉状.pdf",
                reason: "按内容改名",
              },
            ],
            matter_id: "甲案",
            goal: "把扫描件按内容改名",
          }),
          cassetteAssistant("已改名。"),
        );
        const result = await h.runTurn("把那个扫描件按内容改名", { matterId: "甲案" });
        // 通用"手"在第一轮就广告：不靠关键词命中。
        expect(h.request(0).hasAdvertisedTool("apply_file_ops")).toBe(true);
        const applied = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "apply_file_ops");
        expect(applied?.result.ok, JSON.stringify(applied?.result.error)).toBe(true);
        expect(fs.existsSync(path.join(materials, "2026-03-01 民事起诉状.pdf"))).toBe(true);
        expect(fs.existsSync(path.join(materials, "扫描件001.pdf"))).toBe(false);
      },
    );
  });

  it("file-ops: 真相源文件改不动（模型照发也失败）", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, {
          matterId: "甲案",
          title: "甲案",
          matterKind: "litigation",
        });
        h.enqueue(
          cassetteToolCall("apply_file_ops", {
            ops: [{ from: "cases/甲案/CASE.md", to: "cases/甲案/materials/CASE.md" }],
            matter_id: "甲案",
          }),
          cassetteAssistant("这一步办不了。"),
        );
        const result = await h.runTurn("把卷宗文件挪到材料里", { matterId: "甲案" });
        const applied = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "apply_file_ops");
        expect(applied?.result.ok).toBe(false);
        expect(fs.existsSync(path.join(h.workspaceDir, "cases", "甲案", "CASE.md"))).toBe(true);
        expect(
          fs.existsSync(path.join(h.workspaceDir, "cases", "甲案", "materials", "CASE.md")),
        ).toBe(false);
      },
    );
  });

  it("capability-index: 未加载的能力以菜单形式到达模型请求体（不再靠关键词猜）", async () => {
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        // 一句普通指令：不命中任何中文关键词包，也不带钉选。
        await h.runTurn("帮我看看现在能做什么");
        const body = h.request(0);
        // 菜单段落确实进了下一轮请求体。
        expect(body.contains("可按需启用")).toBe(true);
        // 菜单里有本轮未广告的真实能力（execute_workflow 不在核心 12 内）。
        expect(body.contains("execute_workflow")).toBe(true);
        expect(body.hasAdvertisedTool("execute_workflow")).toBe(false);
      },
    );
  });

  it("capability-index: 联网关闭时不把联网能力写进菜单（提示词不得撒谎）", async () => {
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("帮我看看现在能做什么");
        expect(h.request(0).contains("url_dossier")).toBe(false);
        expect(h.request(0).hasAdvertisedTool("web_search")).toBe(false);
      },
    );
  });

  it("folder-to-desk: 案件管理 phrasing without pins advertises the full intake chain", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn(
          "读取 /Users/dev/Downloads/案件/250920 张北县瑞霖乳制品有限公司 文件夹里的所有文件，然后分析所有文件的内容，按照工作台案件管理的需求去自动填写和更新",
        );
        // 读取侧：批量读文件夹正文。
        expect(h.request(0).hasAdvertisedTool("read_folder_documents")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("explore_folder")).toBe(true);
        // 写入侧：案件管理写穿链路（未关联案件也能 create_matter 后继续）。
        expect(h.request(0).hasAdvertisedTool("update_matter_profile")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("create_matter")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("apply_legal_events")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("add_case_note")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("import_host_file")).toBe(true);
      },
    );
  });

  it("folder-to-desk e2e: read all files → create matter → fill profile + deadline on disk", async () => {
    const { listDeadlinesForMatter } = await import("../application/services/deadline-service.js");
    const { loadMatter } = await import("../adapters/matter-storage/index.js");
    const { default: JSZip } = await import("jszip");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        // 真实材料夹：起诉状 docx + 证据 txt。
        const dir = path.join(h.workspaceDir, "案件材料");
        fs.mkdirSync(dir, { recursive: true });
        const zip = new JSZip();
        zip.file(
          "word/document.xml",
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
            `<w:p><w:r><w:t>民事起诉状</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>原告：张北县瑞霖乳制品有限公司</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>被告：某乳业集团有限公司</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>案由：买卖合同纠纷。案号（2026）冀0722民初123号。张北县人民法院。</w:t></w:r></w:p>` +
            `</w:body></w:document>`,
        );
        fs.writeFileSync(
          path.join(dir, "起诉状.docx"),
          await zip.generateAsync({ type: "nodebuffer" }),
        );
        fs.writeFileSync(path.join(dir, "证据清单.txt"), "证据一：送货单原件五张。");

        const title = "张北县瑞霖乳制品有限公司买卖合同纠纷";
        h.enqueue(
          cassetteToolCall("read_folder_documents", { path: "案件材料" }),
          cassetteToolCall("create_matter", { title, matter_kind: "litigation" }),
          cassetteToolCall("update_matter_profile", {
            matter_id: title,
            case_no: "（2026）冀0722民初123号",
            court: "张北县人民法院",
            cause_of_action: "买卖合同纠纷",
            status: "active",
            parties: [
              { name: "张北县瑞霖乳制品有限公司", role: "client", standing: "原告" },
              { name: "某乳业集团有限公司", role: "counterparty", standing: "被告" },
            ],
          }),
          cassetteToolCall("apply_legal_events", {
            matter_id: title,
            events: [{ eventKind: "hearing", title: "开庭", dueAt: "2026-10-12T01:00:00.000Z" }],
          }),
          cassetteAssistant("已读取全部 2 个文件并写入案件管理。"),
        );
        const result = await h.runTurn(
          "读取 案件材料 文件夹里的所有文件，分析所有文件的内容，按照工作台案件管理的需求去自动填写和更新",
          // 未关联案件：链路须自己 create_matter 后继续。
        );
        // 模型真的看到了 docx 正文（不是只看到文件名列表）。
        expect(h.request(1).contains("民事起诉状")).toBe(true);
        expect(h.request(1).contains("证据清单").valueOf()).toBe(true);
        const calls = result.turn.messages.flatMap((m) => m.toolCallResponses ?? []);
        for (const name of [
          "read_folder_documents",
          "create_matter",
          "update_matter_profile",
          "apply_legal_events",
        ]) {
          expect(calls.find((r) => r.name === name)?.result.ok, name).toBe(true);
        }
        // 工作台同一份存储：matter.json + deadlines.jsonl 已落盘。
        const saved = loadMatter(h.workspaceDir, title);
        expect(saved?.docket?.caseNo).toBe("（2026）冀0722民初123号");
        expect(saved?.docket?.court).toBe("张北县人民法院");
        expect(saved?.causeOfAction).toBe("买卖合同纠纷");
        expect(saved?.status).toBe("active");
        expect(saved?.parties?.some((p) => p.role === "client" && p.name.includes("瑞霖"))).toBe(
          true,
        );
        expect(saved?.clientId).toBe("张北县瑞霖乳制品有限公司");
        const deadlines = listDeadlinesForMatter(h.workspaceDir, title);
        expect(deadlines.some((d) => d.eventKind === "hearing")).toBe(true);
      },
    );
  });

  it("desk writes are advertised every turn; list_more_tools catalog still covers them", async () => {
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        h.enqueue(cassetteToolCall("list_more_tools", {}), cassetteAssistant("目录已列出。"));
        await h.runTurn("今天天气怎么样");
        // 案件管理写穿链路始终广告：律师任何措辞都能当场填/更新卷宗。
        expect(h.request(0).hasAdvertisedTool("apply_legal_events")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_matter_profile")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("create_matter")).toBe(true);
        const toolMsg = h
          .session()
          ?.conversationHistory.flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "list_more_tools");
        expect(toolMsg).toBeTruthy();
        // 目录真相源是 DISCLOSED_TOOL_HINTS；入史结果按 ~1k token 预算截断，不承载整表。
        const { DISCLOSED_TOOL_HINTS } = await import("./tools/governance.js");
        expect(DISCLOSED_TOOL_HINTS.some((t) => t.name === "apply_legal_events")).toBe(true);
      },
    );
  });

  it("review-does-not-write-docket", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        const result = await h.runTurn("请审查这份采购合同", {
          contextPins: [
            {
              pinKind: "file",
              root: "project",
              relPath: "采购合同.docx",
              kind: "file",
            },
          ],
        });
        // 写穿工具始终广告（可撤销、无拍板），但审查回合不应真的写卷宗。
        expect(h.request(0).hasAdvertisedTool("apply_legal_events")).toBe(true);
        const deskWrites = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .filter((r) => r.name === "apply_legal_events" || r.name === "update_matter_profile");
        expect(deskWrites).toHaveLength(0);
      },
    );
  });

  it("empty-ocr-does-not-apply", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    const { listDeadlinesForMatter } = await import("../application/services/deadline-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, { matterId: "m-empty", title: "空 OCR" });
        h.enqueue(
          cassetteToolCall("apply_legal_events", {
            events: [{ eventKind: "hearing", title: "开庭" }],
          }),
          cassetteAssistant("未能写入。"),
        );
        await h.runTurn("按传票补开庭", { matterId: "m-empty" });
        expect(listDeadlinesForMatter(h.workspaceDir, "m-empty")).toHaveLength(0);
      },
    );
  });

  it("create_matter fails when matter already bound", async () => {
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        h.enqueue(
          cassetteToolCall("create_matter", { title: "另造一卷" }),
          cassetteAssistant("已拒绝。"),
        );
        const result = await h.runTurn("新建一个案件", { matterId: "already" });
        const create = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "create_matter");
        expect(create?.result.ok).toBe(false);
        expect(create?.result.error).toMatch(/已关联/);
      },
    );
  });

  it("mail short path still advertises apply_legal_events", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn(
          [
            "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
            "默认 contract_edit_baseline_path=`cases/m/a.docx`",
            "建议回复收件人：opp@firm.cn",
            "另外按传票把开庭补上",
          ].join("\n"),
          {
            contextPins: [
              {
                pinKind: "file",
                root: "workspace",
                relPath: "开庭传票.jpg",
                kind: "file",
              },
            ],
          },
        );
        const advertised = h.request(0).advertisedToolNames();
        expect(advertised).toContain("apply_legal_events");
        expect(advertised).not.toContain("send_email");
        expect(advertised).not.toContain("render_document");
      },
    );
  });

  it("steer-second-photo: mid-turn inject pin appears in next request", async () => {
    const { queuePendingContextPins } = await import("./session-context-inject.js");
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.seedHistory([], { matterId: "m-photo" });
        h.onModelRequest((req) => {
          if (req.index === 0) {
            queuePendingContextPins(h.workspaceDir, h.session()!.sessionId, [
              {
                pinKind: "file",
                root: "workspace",
                relPath: "传票第二张.jpg",
                kind: "file",
              },
            ]);
          }
        });
        h.enqueue(cassetteToolCall("analyze_document"), cassetteAssistant("已看到第二张。"));
        await h.runTurn("按传票补开庭", { matterId: "m-photo" });
        expect(h.requests.length).toBeGreaterThanOrEqual(2);
        expect(
          h.request(1).contains("传票第二张.jpg") || h.request(1).contains("本轮补充材料"),
        ).toBe(true);
      },
    );
  });

  it("folder talk: WRITE_HEAVY is rejected until explore_folder ran this turn", async () => {
    const instruction = "继续不澄清。根据【河南堃云顿数据科技有限公司】文件夹起草一份审查备忘。";
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const folder = path.join(h.workspaceDir, "河南堃云顿数据科技有限公司");
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, "往来.txt"), "服务费尚未支付。", "utf8");
        h.enqueue(
          cassetteToolCall("draft_document", { title: "审查备忘" }),
          cassetteToolCall("explore_folder", {
            goal: "根据文件夹起草审查备忘",
            path: "河南堃云顿数据科技有限公司",
          }),
          cassetteToolCall("draft_document", { title: "审查备忘" }),
          cassetteAssistant("已对照文件夹材料起草审查备忘。"),
        );
        const result = await h.runTurn(instruction);
        expect(result.turn.status).toBe("completed");
        expect(h.request(0).contains(instruction)).toBe(true);
        expect(h.request(0).hasAdvertisedTool("explore_folder")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("draft_document")).toBe(true);
        expect(toolErrors(result)).toContain(FOLDER_EXPLORE_GATE_ERROR);
        expect(h.request(1).contains("explore_folder")).toBe(true);
        const executed = h.spy?.log.executedNames() ?? [];
        expect(executed).toContain("explore_folder");
        expect(executed.filter((n) => n === "draft_document")).toEqual(["draft_document"]);
        expect(h.spy?.log.calls.find((c) => c.name === "explore_folder")?.result.ok).toBe(true);
        expect(h.spy?.log.calls.find((c) => c.name === "draft_document")?.result.ok).toBe(true);
      },
    );
  });

  it("tool budget does not ask the lawyer to continue; the turn completes without continue_tools", async () => {
    await withTestLawMind(
      (b) => b.withMaxToolCalls(2),
      async (h) => {
        h.enqueue(
          cassetteToolCall("search_statute", { query: "违约" }),
          cassetteToolCall("search_statute", { query: "付款" }),
        );
        const result = await h.runTurn(FAST_LANE);
        expect(result.turn.status).toBe("completed");
        expect(result.turn.requiresAction ?? []).toEqual([]);
        expect(h.spy?.log.executedNames().filter((n) => n === "search_statute")).toHaveLength(2);
      },
    );
  });

  it("default-scale budget keeps sampling after the old ask point until the model delivers", async () => {
    await withTestLawMind(
      (b) => b.withMaxToolCalls(25),
      async (h) => {
        h.enqueue(
          cassetteToolCall("search_statute", { query: "违约" }),
          cassetteToolCall("search_statute", { query: "付款" }),
          cassetteAssistant("审查意见：注意付款与违约条款。"),
        );
        const result = await h.runTurn(FAST_LANE);
        expect(result.turn.status).toBe("completed");
        expect(result.reply).toContain("审查意见");
        expect(result.turn.requiresAction ?? []).toEqual([]);
        expect(h.requests.length).toBe(3);
      },
    );
  });

  it("review-table: 抽查表 intent advertises review_table_update and the table sidecar lands", async () => {
    const { persistDraft } = await import("../drafts/index.js");
    const { readReviewTable } = await import("../deliverables/review-table.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        persistDraft(h.workspaceDir, {
          taskId: "t-review-table",
          title: "尽调审查表",
          summary: "",
          output: "docx",
          templateId: "word/legal-memo-default",
          deliverableType: "review.table",
          sections: [{ heading: "结论与说明", body: "见审查表明细。", citations: [] }],
          reviewNotes: [],
          reviewStatus: "pending",
          createdAt: ts(),
        });
        h.enqueue(
          cassetteToolCall("review_table_update", {
            task_id: "t-review-table",
            action: "set_template",
            template: "due_diligence",
          }),
          cassetteToolCall("review_table_update", {
            task_id: "t-review-table",
            action: "add_rows",
            rows: [{ cells: { item: "股权结构", risk: "高" }, source: "cases/m/materials/a.pdf" }],
          }),
          cassetteAssistant("审查表已建好。"),
        );
        const result = await h.runTurn("给这份尽调出一张审查表");
        const calls = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .filter((r) => r.name === "review_table_update");
        expect(calls.length).toBe(2);
        expect(calls.every((c) => c.result.ok)).toBe(true);
        // sidecar 真落盘，且行级 source 同步进来源列。
        const table = readReviewTable(h.workspaceDir, "t-review-table");
        expect(table?.template).toBe("due_diligence");
        expect(table?.rows).toHaveLength(1);
        expect(table?.rows[0]?.cells.source).toBe("cases/m/materials/a.pdf");
      },
    );
  });

  it("organize-flow: 整理案卷 advertises propose/execute; execute without a confirmed plan fails honestly", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        createMatterIfMissing(h.workspaceDir, { matterId: "m-org", title: "整理案" });
        h.enqueue(
          cassetteToolCall("execute_organize_plan", { plan_id: "org-nope" }),
          cassetteAssistant("需要先出计划。"),
        );
        const result = await h.runTurn("帮我把本案 materials 整理一下", { matterId: "m-org" });
        // 整理意图：计划/执行工具都广告。
        expect(h.request(0).hasAdvertisedTool("propose_organize_plan")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("execute_organize_plan")).toBe(true);
        // 未经确认计划的执行被诚实拒绝（不静默动文件）。
        const exec = result.turn.messages
          .flatMap((m) => m.toolCallResponses ?? [])
          .find((r) => r.name === "execute_organize_plan");
        expect(exec?.result.ok).toBe(false);
        expect(exec?.result.error).toContain("propose_organize_plan");
      },
    );
  });

  it("matter-brief: bound matter injects parties and open deadlines into the first request", async () => {
    const { createMatterIfMissing, updateMatterProfile } =
      await import("../application/services/matter-write-service.js");
    const { applyLegalEvents } = await import("../desk/desk-apply.js");
    await withTestLawMind(
      (b) => b,
      async (h) => {
        createMatterIfMissing(h.workspaceDir, { matterId: "m-brief", title: "买卖合同纠纷" });
        await updateMatterProfile(h.workspaceDir, {
          matterId: "m-brief",
          parties: [
            { name: "张甲", role: "client" },
            { name: "李乙", role: "counterparty" },
          ],
        });
        await applyLegalEvents(h.workspaceDir, "m-brief", [
          {
            eventKind: "hearing",
            title: "开庭",
            dueAt: "2026-10-12T01:00:00.000Z",
            notes: "",
          },
        ]);
        h.enqueue(cassetteAssistant("已处理。"));
        await h.runTurn("看看本案情况", { matterId: "m-brief" });
        // 案件上下文继承：首轮请求体带结构化速览（当事人/未决期限），不靠律师重述。
        expect(h.request(0).contains("本案速览")).toBe(true);
        expect(h.request(0).contains("张甲")).toBe(true);
        expect(h.request(0).contains("李乙")).toBe(true);
        expect(h.request(0).contains("2026-10-12")).toBe(true);
      },
    );
  });

  it("no-task turn: 单字 k 保留清单但不得重启改稿流水线（Codex 对齐）", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        // 上一轮：律师交办改稿，模型写下清单（落盘）。
        h.enqueue(
          cassetteToolCall("update_plan", {
            plan: [
              { step: "通读附件原文与批注", status: "in_progress" },
              { step: "最小锚定落改", status: "pending" },
            ],
            goal: "按批注改这份合同",
            not_goal: "不重建原件",
            materials: "合作协议.docx",
            done: "出审阅痕迹稿",
          }),
          cassetteAssistant("已登记清单，开始通读。"),
        );
        const first = await h.runTurn("继续不澄清。按批注改这份合同，出审阅痕迹稿。");
        expect(first.turn.status).toBe("completed");
        expect(h.session()?.turnPlan?.items).toHaveLength(2);

        // 第二轮：律师只回一个 k（真实事故：引擎把上一轮改稿重跑了 19 次工具调用）。
        h.enqueue(cassetteAssistant("收到。本件停在改稿缺口，需要我继续吗？"));
        const second = await h.runTurn("k");
        expect(second.turn.status).toBe("completed");
        // 本轮只让模型回一句：不再有第二轮工具往返。
        expect(h.requests).toHaveLength(3);

        // 1) 写类 / 计划工具不再进广告表（下一份请求体可核验，不靠模型自觉）。
        const noTaskReq = h.request(-1);
        expect(noTaskReq.hasAdvertisedTool("apply_surgical_edits")).toBe(false);
        expect(noTaskReq.hasAdvertisedTool("draft_document")).toBe(false);
        expect(noTaskReq.hasAdvertisedTool("update_draft")).toBe(false);
        expect(noTaskReq.hasAdvertisedTool("render_tracked_draft")).toBe(false);
        expect(noTaskReq.hasAdvertisedTool("execute_workflow")).toBe(false);
        expect(noTaskReq.hasAdvertisedTool("prepare_outbound_mail")).toBe(false);
        expect(noTaskReq.hasAdvertisedTool("analyze_document")).toBe(true);
        // update_plan 由 resolveModelToolNames 兜底补进广告表（每轮 rebuild 都会补），
        // 所以无任务回合的执法点在闸门：硬塞 update_plan 会被拒（见下一条 cassette）。
        // 3) 上一轮清单不注入：无任务回合不能借它继续办件。
        expect(noTaskReq.contains("<!--lm-ws:plan-->")).toBe(false);
        expect(noTaskReq.systemText()).not.toContain("turn_plan");
        // 4) 清单本身保留：律师之后明确说「继续」还能接着办。
        expect(h.session()?.turnPlan?.items).toHaveLength(2);

        // 5) 硬塞 update_plan 也写不进去：无任务回合不得用假清单覆盖本件清单。
        h.enqueue(
          cassetteToolCall("update_plan", {
            plan: [
              { step: "闲写清单", status: "in_progress" },
              { step: "再闲写", status: "pending" },
            ],
          }),
          cassetteAssistant("已停。"),
        );
        await h.runTurn("好的");
        expect(h.spy?.log.calls.filter((call) => call.name === "update_plan")).toHaveLength(1);
        expect(h.session()?.turnPlan?.items.map((item) => item.step)).toEqual([
          "通读附件原文与批注",
          "最小锚定落改",
        ]);
      },
    );
  });

  it("no-task turn: 模型硬塞 apply_surgical_edits 会被拒并落到 gateDecisions", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(
          cassetteToolCall("apply_surgical_edits", { task_id: "20444511" }),
          cassetteAssistant("已停，缺口交律师。"),
        );
        const result = await h.runTurn("好的");
        expect(result.turn.status).toBe("completed");
        expect(h.spy?.log.executedNames()).not.toContain("apply_surgical_edits");
        expect(toolErrors(result)).toMatch(/没有新指令|单字|确认/);
        expect(
          result.turn.gateDecisions?.some(
            (g) => g.gate === "dangerous_tool_gate" && g.decision === "block",
          ),
        ).toBe(true);
      },
    );
  });

  it("no-task turn: 明确续作指令「继续」仍按本件清单接着办", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(
          cassetteToolCall("update_plan", {
            plan: [
              { step: "通读附件原文", status: "in_progress" },
              { step: "最小锚定落改", status: "pending" },
            ],
          }),
          cassetteAssistant("已登记清单。"),
        );
        await h.runTurn("继续不澄清。按批注改这份合同。");

        h.enqueue(cassetteAssistant("接着改第二处。"));
        await h.runTurn("继续");
        // 续作回合照旧拿到清单（否则律师没有任何办法接着办本件）。
        expect(h.request(-1).contains("<!--lm-ws:plan-->")).toBe(true);
        expect(h.request(-1).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
      },
    );
  });

  it("中断轮次：在办显示中断，恢复通道按 id 找回本件并带出原指令", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        const original = "按国浩批注改这份合作协议，出审阅痕迹稿";
        const session = h.seedHistory(
          [
            {
              role: "user",
              content:
                "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\n默认 contract_edit_baseline_path=`cases/m-int/协议.doc`",
              timestamp: ts(),
            },
          ],
          { matterId: "m-int" },
        );
        // 模拟「应用退出」：占位轮次仍是 running，没有收尾记录（真实事故的状态）。
        session.turns.push({
          turnId: "turn-interrupted",
          sessionId: session.sessionId,
          instruction: original,
          messages: [],
          toolCallsExecuted: 5,
          status: "running",
          startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        });
        saveSession(h.workspaceDir, session);
        expect(isSessionTurnLive(h.workspaceDir, session.sessionId)).toBe(false);

        // 在办看得见「被中断」（而不是当作还在跑）。
        const fleet = await buildAgentFleetSummary({ workspaceDir: h.workspaceDir });
        expect(fleet.runs.find((r) => r.sessionId === session.sessionId)?.status).toBe(
          "interrupted",
        );

        // 「继续本件」：按稳定 id 找回，原指令进请求体，模型接着办同一件事。
        h.enqueue(cassetteAssistant("接着办：继续按批注落改。"));
        const result = await h.resume({
          sessionId: session.sessionId,
          actionId: "interrupted:turn-interrupted",
          decision: "approve",
        });
        expect(result.turn.status).toBe("completed");
        expect(h.request(-1).contains("【从检查点继续】")).toBe(true);
        expect(h.request(-1).contains(original)).toBe(true);
        expect(loadSession(h.workspaceDir, session.sessionId)?.turns[0]?.status).toBe("completed");
      },
    );
  });

  it("门禁停下：本件转待律师，缺口进待办，同一份基线不再被重复派单", async () => {
    await withTestLawMind(
      (b) =>
        b.withToolExecute("render_tracked_draft", async () => ({
          ok: false,
          error: "独立审稿未过",
          data: {
            taskId: "task-gate",
            code: "legal_guardian_fail",
            gateDecision: { gate: "legal_guardian_gate", decision: "block" },
            guardian: {
              verdict: "fail",
              round: 3,
              maxRounds: 2,
              skipReason: "独立审稿已 2 轮未过。请把缺口交给律师，不要继续为过审而改稿。",
              gaps: [
                {
                  code: "guardian_exhausted",
                  message: "独立审稿已 2 轮未过。请把缺口交给律师。",
                },
              ],
            },
          },
        })),
      async (h) => {
        const { ensureLawyerWorkForTurn, findLawyerWork } = await import("../work/index.js");
        const { findBlockedDispatch, dispatchFingerprint } =
          await import("../platform/automation-dispatch-ledger.js");
        const rel = "cases/m-gate/协议.doc";
        const instruction = `【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=\`${rel}\``;
        const session = h.seedHistory([], { matterId: "m-gate" });
        ensureLawyerWorkForTurn({
          workspaceDir: h.workspaceDir,
          sessionId: session.sessionId,
          instruction,
          matterId: "m-gate",
        });

        h.enqueue(cassetteToolCall("render_tracked_draft", { task_id: "task-gate" }));
        h.enqueue(cassetteAssistant("已停：缺口交给律师。"));
        const result = await h.runTurn(instruction, {
          sessionId: session.sessionId,
          matterId: "m-gate",
        });
        expect(result.turn.error).toBeUndefined();
        expect(result.turn.status).toBe("completed");

        // 1) 缺口进律师待办（在办/待拍板可见，点「知道了」即收起）
        const blocked = result.turn.requiresAction?.find((a) => a.kind === "workflow_blocked");
        expect(blocked?.summary).toContain("需要您处置");
        // 2) 本件状态转「待律师」，不再挂着 running
        expect(findLawyerWork(h.workspaceDir, { sessionId: session.sessionId })?.status).toBe(
          "needs_lawyer",
        );
        // 3) 同一份基线不再被重复派单；材料没变就仍然挡着
        const fp = dispatchFingerprint(h.workspaceDir, rel);
        expect(
          findBlockedDispatch(h.workspaceDir, {
            matterId: "m-gate",
            relativePath: rel,
            fingerprint: fp,
          }),
        ).toBeTruthy();
      },
    );
  });
  it("职务说明书：律师写下的岗位边界落进下一次模型请求", async () => {
    // 名册化（策略文档 A3）的准入断言：说明书的**动态注入值**必须真的到达
    // 模型请求体——否则单测全绿、功能却是死的（提示词装配走的是
    // buildRoleDirectiveFromProfile → config.roleDirective → system prompt）。
    const directive = buildRoleDirectiveFromProfile({
      assistantId: "a-brief",
      displayName: "小陈",
      introduction: "律所通用法律助理。",
      jobBrief: {
        responsibility: "盯本案合同续签",
        prohibitions: "外发邮件前必须问律师",
        escalation: "客户材料缺失就停下来问，不要自己补",
      },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }).roleDirective;

    await withTestLawMind(
      (b) =>
        b.withConfig((config) => {
          config.roleDirective = directive;
        }),
      async (h) => {
        h.enqueue(cassetteAssistant("收到。"));
        await h.runTurn("把本周到期的合同列一下。");
        const body = h.request(0);
        expect(body.contains("职务说明书")).toBe(true);
        expect(body.contains("盯本案合同续签")).toBe(true);
        expect(body.contains("外发邮件前必须问律师")).toBe(true);
        expect(body.contains("客户材料缺失就停下来问，不要自己补")).toBe(true);
      },
    );
  });

  it("职务说明书：没填说明书的助手，提示词里不出现空标题", async () => {
    const directive = buildRoleDirectiveFromProfile({
      assistantId: "a-plain",
      displayName: "小陈",
      introduction: "律所通用法律助理。",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }).roleDirective;

    await withTestLawMind(
      (b) =>
        b.withConfig((config) => {
          config.roleDirective = directive;
        }),
      async (h) => {
        h.enqueue(cassetteAssistant("收到。"));
        await h.runTurn("把本周到期的合同列一下。");
        // 空说明书不该在请求体里留下一个没有内容的「职务说明书」标题。
        expect(h.request(0).contains("职务说明书")).toBe(false);
      },
    );
  });
});

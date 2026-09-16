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
import {
  DELIVERY_MARKER_CHAT_QA,
  DELIVERY_MARKER_OPINION_MEMO,
} from "../intent/delivery-intent.js";
import { INTENT_HYPOTHESIS_HEADING, UNDERSTAND_FIRST_HEADING } from "../intent/understand-first.js";
import { WORKING_BRIEF_HEADING } from "../intent/working-brief.js";
import { COMPACT_REINJECTION_MARKER } from "./compact-insert.js";
import { MAIL_CONTRACT_FAST_PATH_DENIED_HINT } from "./mail-contract-fast-path.js";
import { formatSteerUserMessage } from "./session-context-steer.js";
import { cassetteAssistant, cassetteToolCall, withTestLawMind } from "./testkit/index.js";
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
});

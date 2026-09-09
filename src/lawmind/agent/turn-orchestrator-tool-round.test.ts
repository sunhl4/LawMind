import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findUnpairedToolCallIds } from "./session-tool-call-pairing.js";
import { ToolRegistry } from "./tools/registry.js";
import {
  executeToolBatches,
  shouldPreApproveSandboxWorkflowStep,
} from "./turn-orchestrator-tool-round.js";
import type { AgentContext, AgentMessage, AgentTurn } from "./types.js";

let testWorkspaceDir: string;

beforeEach(() => {
  testWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-tort-"));
});

afterEach(() => {
  try {
    fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function stubTurn(): AgentTurn {
  return {
    turnId: "t1",
    sessionId: "s1",
    instruction: "x",
    messages: [],
    toolCallsExecuted: 0,
    status: "running",
    gateDecisions: [],
    startedAt: new Date().toISOString(),
  };
}

describe("shouldPreApproveSandboxWorkflowStep (C3)", () => {
  it("approves sandbox workflow tools when policy on and not Firm-strict", () => {
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "execute_workflow",
        strictDangerousToolApproval: false,
      }),
    ).toBe(true);
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "draft_document",
        strictDangerousToolApproval: false,
      }),
    ).toBe(true);
  });

  it("never auto-approves render or when Firm-strict", () => {
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "render_document",
        strictDangerousToolApproval: false,
      }),
    ).toBe(false);
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "execute_workflow",
        strictDangerousToolApproval: true,
      }),
    ).toBe(false);
  });

  it("requires policy + sandbox", () => {
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: false,
        toolSandboxEnabled: true,
        toolName: "execute_workflow",
      }),
    ).toBe(false);
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: false,
        toolName: "execute_workflow",
      }),
    ).toBe(false);
  });
});

describe("executeToolBatches discovery-cap live trace", () => {
  it("does not emit a red 分析文书 when the cap already used the successful read", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: "analyze_document",
        description: "analyze",
        category: "analyze",
        parameters: {},
      },
      async execute() {
        executed = true;
        return { ok: true };
      },
    });
    const turn: AgentTurn = {
      turnId: "t1",
      sessionId: "s1",
      instruction: "改合同",
      messages: [],
      toolCallsExecuted: 1,
      toolNameCallCounts: { analyze_document: 1 },
      status: "running",
      gateDecisions: [],
      startedAt: new Date().toISOString(),
    };
    const events: Array<{ type: string; toolName?: string }> = [];
    const history: AgentMessage[] = [];
    await executeToolBatches({
      toolRefs: [{ id: "tc-repeat", name: "analyze_document", arguments: { path: "playbooks/x" } }],
      registry,
      turn,
      ctx: { workspaceDir: testWorkspaceDir } as AgentContext,
      roundIndex: 2,
      assistantContent: "",
      maxToolCalls: 10,
      toolTimeoutMs: 5000,
      strictDangerousToolApproval: false,
      allowDangerousToolsWithoutApproval: true,
      toolSandboxEnabled: false,
      actorId: "test",
      pendingClarificationQuestions: [],
      emitEvent: (event) => {
        events.push(event);
      },
      pushMessage: (msg) => {
        history.push(msg);
      },
    });
    expect(executed).toBe(false);
    expect(
      events.filter((e) => e.type === "tool_call_start" || e.type === "tool_call_end"),
    ).toEqual([]);
    expect(history.some((msg) => msg.role === "tool")).toBe(true);
    expect(
      history
        .flatMap((msg) => msg.toolCallResponses ?? [])
        .some((resp) => !resp.result.ok && String(resp.result.error ?? "").includes("上限")),
    ).toBe(true);
  });
});

describe("executeToolBatches dangling tool_call pairing", () => {
  it("sequential batch: remaining calls get a paired skip message when first needs approval", async () => {
    const registry = new ToolRegistry();
    let mailExecuted = false;
    let writeExecuted = false;
    registry.register({
      definition: {
        name: "send_email",
        description: "send mail",
        category: "draft",
        parameters: {},
        requiresApproval: true,
      },
      async execute() {
        mailExecuted = true;
        return { ok: true };
      },
    });
    registry.register({
      definition: {
        name: "write_document",
        description: "write doc",
        category: "draft",
        parameters: {},
      },
      async execute() {
        writeExecuted = true;
        return { ok: true };
      },
    });
    const turn = stubTurn();
    const history: AgentMessage[] = [];
    const result = await executeToolBatches({
      toolRefs: [
        { id: "call-1", name: "send_email", arguments: { to: "a@b.com" } },
        { id: "call-2", name: "write_document", arguments: {} },
      ],
      registry,
      turn,
      ctx: { workspaceDir: testWorkspaceDir } as AgentContext,
      roundIndex: 1,
      assistantContent: "",
      maxToolCalls: 10,
      toolTimeoutMs: 5000,
      strictDangerousToolApproval: true,
      allowDangerousToolsWithoutApproval: false,
      toolSandboxEnabled: false,
      actorId: "test",
      pendingClarificationQuestions: [],
      emitEvent: () => {},
      pushMessage: (msg) => {
        history.push(msg);
      },
    });

    expect(result.stoppedForApproval).toBe(true);
    expect(turn.status).toBe("awaiting_approval");
    expect(mailExecuted).toBe(false);
    expect(writeExecuted).toBe(false);
    // 两个 tool_call 都有配对 tool 消息：第一个是 approvalRequest 结果，第二个是「已跳过」。
    expect(history).toHaveLength(2);
    expect(history[0]?.toolCallResponses?.[0]?.toolCallId).toBe("call-1");
    expect(history[1]?.toolCallResponses?.[0]?.toolCallId).toBe("call-2");
    expect(history[1]?.toolCallResponses?.[0]?.result.ok).toBe(false);
    expect(history[1]?.toolCallResponses?.[0]?.result.error).toContain("已跳过");
    // 组装完整轮历史（assistant + tool 消息）后无悬空调用。
    const fullHistory: AgentMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", name: "send_email", arguments: { to: "a@b.com" } },
          { id: "call-2", name: "write_document", arguments: {} },
        ],
        timestamp: new Date().toISOString(),
      },
      ...history,
    ];
    expect(findUnpairedToolCallIds(fullHistory)).toEqual([]);
  });

  it("concurrent batch: later slices get a paired skip message when an earlier slice needs approval", async () => {
    const registry = new ToolRegistry();
    const executed: string[] = [];
    const makeTool = (name: string, approvalRequest = false) => ({
      definition: {
        name,
        description: name,
        category: "search" as const,
        parameters: {},
        isConcurrencySafe: true,
      },
      execute: async () => {
        executed.push(name);
        return approvalRequest ? { ok: true, approvalRequest: true } : { ok: true };
      },
    });
    // 并发上限默认 4：5 个并发安全调用分两片；第一片里 tool_2 需要审批。
    registry.register(makeTool("tool_1"));
    registry.register(makeTool("tool_2", true));
    registry.register(makeTool("tool_3"));
    registry.register(makeTool("tool_4"));
    registry.register(makeTool("tool_5"));
    const turn = stubTurn();
    const history: AgentMessage[] = [];
    const result = await executeToolBatches({
      toolRefs: [1, 2, 3, 4, 5].map((n) => ({
        id: `call-${n}`,
        name: `tool_${n}`,
        arguments: {},
      })),
      registry,
      turn,
      ctx: { workspaceDir: testWorkspaceDir } as AgentContext,
      roundIndex: 1,
      assistantContent: "",
      maxToolCalls: 10,
      toolTimeoutMs: 5000,
      strictDangerousToolApproval: false,
      allowDangerousToolsWithoutApproval: true,
      toolSandboxEnabled: false,
      actorId: "test",
      pendingClarificationQuestions: [],
      emitEvent: () => {},
      pushMessage: (msg) => {
        history.push(msg);
      },
    });

    expect(result.stoppedForApproval).toBe(true);
    // 第二片（tool_5）未执行，但仍有配对 tool 消息。
    expect(executed).toEqual(["tool_1", "tool_2", "tool_3", "tool_4"]);
    expect(history).toHaveLength(5);
    const skipped = history[4];
    expect(skipped?.toolCallResponses?.[0]?.toolCallId).toBe("call-5");
    expect(skipped?.toolCallResponses?.[0]?.result.ok).toBe(false);
    expect(skipped?.toolCallResponses?.[0]?.result.error).toContain("已跳过");
    const fullHistory: AgentMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [1, 2, 3, 4, 5].map((n) => ({
          id: `call-${n}`,
          name: `tool_${n}`,
          arguments: {},
        })),
        timestamp: new Date().toISOString(),
      },
      ...history,
    ];
    expect(findUnpairedToolCallIds(fullHistory)).toEqual([]);
  });
});

describe("executeToolBatches delegation budget shard", () => {
  it("refreshes ctx.remainingToolCallBudget before each tool executes", async () => {
    // 委派树预算账的父侧：协作工具在 execute 里读到「hard ceiling − 已用」，
    // 用于给子助手分片。第二次调用应看到收缩后的剩余。
    const registry = new ToolRegistry();
    const observed: number[] = [];
    registry.register({
      definition: {
        name: "delegate_task",
        description: "delegate",
        category: "system",
        parameters: {},
      },
      async execute(_args, ctx) {
        observed.push(ctx.remainingToolCallBudget ?? -1);
        return { ok: true, data: {} };
      },
    });
    const turn = stubTurn();
    await executeToolBatches({
      toolRefs: [
        { id: "call-1", name: "delegate_task", arguments: {} },
        { id: "call-2", name: "delegate_task", arguments: {} },
      ],
      registry,
      turn,
      ctx: { workspaceDir: testWorkspaceDir } as AgentContext,
      roundIndex: 1,
      assistantContent: "",
      maxToolCalls: 10,
      toolTimeoutMs: 5000,
      strictDangerousToolApproval: false,
      allowDangerousToolsWithoutApproval: true,
      toolSandboxEnabled: false,
      actorId: "test",
      pendingClarificationQuestions: [],
      emitEvent: () => {},
      pushMessage: () => {},
    });
    // 第 1 次调用前已用 1 → 剩 9；第 2 次前已用 2 → 剩 8。
    expect(observed).toEqual([9, 8]);
  });
});

describe("executeToolBatches permission-mode hard gate", () => {
  it("readonly turn: a model write call bypassing the ad list is blocked at execution layer", async () => {
    // 对抗场景：readonly 轮里模型直接点名写工具（广告清单之外）。管线必须硬拦，
    // 记录 dangerous_tool_gate 阻断决定，且 turn 不进入 awaiting_approval。
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: "write_document",
        description: "write doc",
        category: "draft",
        parameters: {},
      },
      async execute() {
        executed = true;
        return { ok: true };
      },
    });
    const turn = stubTurn();
    const history: AgentMessage[] = [];
    const result = await executeToolBatches({
      toolRefs: [{ id: "call-w", name: "write_document", arguments: { file_path: "x.md" } }],
      registry,
      turn,
      ctx: { workspaceDir: testWorkspaceDir, permissionMode: "readonly" } as AgentContext,
      roundIndex: 1,
      assistantContent: "",
      maxToolCalls: 10,
      toolTimeoutMs: 5000,
      strictDangerousToolApproval: false,
      allowDangerousToolsWithoutApproval: true,
      toolSandboxEnabled: false,
      actorId: "test",
      pendingClarificationQuestions: [],
      emitEvent: () => {},
      pushMessage: (msg) => {
        history.push(msg);
      },
    });

    expect(executed).toBe(false);
    expect(result.stoppedForApproval).toBe(false);
    expect(turn.status).toBe("running");
    const resp = history[0]?.toolCallResponses?.[0];
    expect(resp?.result.ok).toBe(false);
    expect(String(resp?.result.error ?? "")).toContain("只读");
    expect(String(resp?.result.error ?? "")).toContain("write_document");
    expect(
      turn.gateDecisions?.some((g) => g.gate === "dangerous_tool_gate" && g.decision === "block"),
    ).toBe(true);
  });

  it("standard turn: the same write call is not blocked by the permission gate", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: "write_document",
        description: "write doc",
        category: "draft",
        parameters: {},
      },
      async execute() {
        executed = true;
        return { ok: true };
      },
    });
    const turn = stubTurn();
    await executeToolBatches({
      toolRefs: [{ id: "call-w", name: "write_document", arguments: {} }],
      registry,
      turn,
      ctx: { workspaceDir: testWorkspaceDir, permissionMode: "standard" } as AgentContext,
      roundIndex: 1,
      assistantContent: "",
      maxToolCalls: 10,
      toolTimeoutMs: 5000,
      strictDangerousToolApproval: false,
      allowDangerousToolsWithoutApproval: true,
      toolSandboxEnabled: false,
      actorId: "test",
      pendingClarificationQuestions: [],
      emitEvent: () => {},
      pushMessage: () => {},
    });
    expect(executed).toBe(true);
    expect(turn.gateDecisions?.some((g) => g.gate === "dangerous_tool_gate")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./tools/registry.js";
import {
  executeToolBatches,
  shouldPreApproveSandboxWorkflowStep,
} from "./turn-orchestrator-tool-round.js";
import type { AgentContext, AgentMessage, AgentTurn } from "./types.js";

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
      ctx: { workspaceDir: "/tmp" } as AgentContext,
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

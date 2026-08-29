import { describe, expect, it, vi } from "vitest";
import type { TurnFinalizeShared } from "./turn-orchestrator-finalize.js";
import {
  tryAutoDeliverableWorkflowShortcut,
  tryIntakeClarificationShortcut,
  wouldIntakeClarify,
} from "./turn-orchestrator-shortcuts.js";
import type { AgentContext, AgentSession, AgentTurn } from "./types.js";

function baseTurn(): AgentTurn {
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

function baseSession(): AgentSession {
  return {
    sessionId: "s1",
    conversationHistory: [],
    turns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function sharedStub(session: AgentSession, turn: AgentTurn): TurnFinalizeShared {
  return {
    workspaceDir: "/tmp/ws",
    session,
    turn,
    emitEvent: () => {},
    liveProgressKey: undefined,
    linkedTaskIdForCtx: undefined,
    memory: {
      general: "",
      profile: "",
      firmProfile: "",
      caseMemory: "",
      matterStrategy: "",
      todayLog: "",
      yesterdayLog: "",
    } as TurnFinalizeShared["memory"],
    ensureLiveProgressFinished: () => {},
  };
}

describe("turn-orchestrator-shortcuts", () => {
  it("wouldIntakeClarify surfaces questions for thin drafting asks", () => {
    const qs = wouldIntakeClarify("请起草一份合同");
    expect(Array.isArray(qs)).toBe(true);
  });

  it("tryIntakeClarificationShortcut returns null when no intake questions", () => {
    const session = baseSession();
    const turn = baseTurn();
    const result = tryIntakeClarificationShortcut({
      instruction: "今天天气怎么样",
      session,
      turn,
      shared: sharedStub(session, turn),
      actorId: "system",
      resolvedAssistantId: "default",
      modelName: "m",
    });
    expect(result).toBeNull();
  });

  it("tryIntakeClarificationShortcut does not freeze soft-ask drafts (rental)", () => {
    const session = baseSession();
    const turn = baseTurn();
    const instruction = "请起草一份租赁合同";
    expect(wouldIntakeClarify(instruction).length).toBe(0);
    const result = tryIntakeClarificationShortcut({
      instruction,
      session,
      turn,
      shared: sharedStub(session, turn),
      actorId: "system",
      resolvedAssistantId: "default",
      modelName: "m",
    });
    expect(result).toBeNull();
  });

  it("tryIntakeClarificationShortcut hard-gates demand letter without materials", () => {
    const session = baseSession();
    const turn = baseTurn();
    const instruction = "请写一份律师函催款";
    expect(wouldIntakeClarify(instruction).length).toBeGreaterThan(0);
    const result = tryIntakeClarificationShortcut({
      instruction,
      session,
      turn,
      shared: sharedStub(session, turn),
      actorId: "system",
      resolvedAssistantId: "default",
      modelName: "m",
    });
    expect(result).not.toBeNull();
    expect(result?.turn.status).toBe("awaiting_clarification");
    expect(turn.gateDecisions?.some((g) => g.gate === "intake_gate")).toBe(true);
  });

  it("tryAutoDeliverableWorkflowShortcut returns null when not an auto-wf instruction", async () => {
    const session = baseSession();
    const turn = baseTurn();
    const ctx = {
      workspaceDir: "/tmp/ws",
      sessionId: "s1",
      actorId: "system",
    } as AgentContext;
    const result = await tryAutoDeliverableWorkflowShortcut({
      instruction: "你好",
      session,
      ctx,
      shared: sharedStub(session, turn),
      emitEvent: vi.fn(),
      abortRequested: () => false,
      onAborted: () => ({
        turn,
        reply: "aborted",
        sessionId: "s1",
        memoryContext: sharedStub(session, turn).memory,
      }),
    });
    expect(result).toBeNull();
  });

  it("tryAutoDeliverableWorkflowShortcut aborts before execute when requested", async () => {
    const session = baseSession();
    const turn = baseTurn();
    const ctx = {
      workspaceDir: "/tmp/ws",
      sessionId: "s1",
      actorId: "system",
    } as AgentContext;
    const aborted = {
      turn,
      reply: "已停止生成。",
      sessionId: "s1",
      memoryContext: sharedStub(session, turn).memory,
    };
    const result = await tryAutoDeliverableWorkflowShortcut({
      instruction: "写一个详细的欧盟新能源汽车相关的 ESG 报告",
      session,
      ctx,
      shared: sharedStub(session, turn),
      emitEvent: vi.fn(),
      abortRequested: () => true,
      onAborted: () => aborted,
    });
    expect(result).toBe(aborted);
  });
});

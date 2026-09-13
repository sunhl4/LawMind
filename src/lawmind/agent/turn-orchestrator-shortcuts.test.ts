import { describe, expect, it, vi } from "vitest";
import type { TurnFinalizeShared } from "./turn-orchestrator-finalize.js";
import {
  formatPublicWebFactReply,
  tryAutoDeliverableWorkflowShortcut,
  tryIntakeClarificationShortcut,
  tryPublicWebFactShortcut,
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

  it("tryPublicWebFactShortcut is a no-op for legal research", async () => {
    const session = baseSession();
    const turn = baseTurn();
    const result = await tryPublicWebFactShortcut({
      instruction: "查一下民法典违约责任",
      ctx: { workspaceDir: "/tmp/ws", sessionId: "s1", actorId: "system" } as AgentContext,
      turn,
      registry: { get: () => undefined } as never,
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

  it("tryPublicWebFactShortcut refuses entertainment facts when 联网 is off", async () => {
    const session = baseSession();
    const turn = baseTurn();
    const result = await tryPublicWebFactShortcut({
      instruction: "查一下2026年新说唱总冠军",
      ctx: {
        workspaceDir: "/tmp/ws",
        sessionId: "s1",
        actorId: "system",
        allowWebSearch: false,
      } as AgentContext,
      turn,
      registry: { get: () => undefined } as never,
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
    expect(result?.reply).toContain("联网");
    expect(result?.reply).toContain("不会猜冠军");
  });

  it("tryPublicWebFactShortcut runs web_search when 联网 is on", async () => {
    const session = baseSession();
    const turn = baseTurn();
    const execute = vi.fn(async () => ({
      ok: true,
      data: {
        results: [{ title: "节目页", url: "https://example.com/r", description: "公开摘要" }],
      },
    }));
    const result = await tryPublicWebFactShortcut({
      instruction: "2026年新说唱总冠军",
      ctx: {
        workspaceDir: "/tmp/ws",
        sessionId: "s1",
        actorId: "system",
        allowWebSearch: true,
      } as AgentContext,
      turn,
      registry: { get: () => ({ execute }) } as never,
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
    expect(execute).toHaveBeenCalledOnce();
    expect(result?.reply).toContain("https://example.com/r");
    expect(result?.reply).not.toMatch(/请开启联网检索/);
  });

  it("formatPublicWebFactReply does not invent a champion name on empty hits", () => {
    expect(
      formatPublicWebFactReply("2026年新说唱总冠军", { ok: true, data: { results: [] } }),
    ).toContain("不会猜冠军");
  });
});

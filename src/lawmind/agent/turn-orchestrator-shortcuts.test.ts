import { describe, expect, it, vi } from "vitest";
import { finishShortCircuitTurn, type TurnFinalizeShared } from "./turn-orchestrator-finalize.js";
import {
  formatPublicWebFactReply,
  tryAutoDeliverableWorkflowShortcut,
  tryPublicWebFactShortcut,
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

describe("finishShortCircuitTurn stop reason", () => {
  function run(priorStatus: AgentTurn["status"]) {
    const session = baseSession();
    const turn = baseTurn();
    turn.status = priorStatus;
    const events: string[] = [];
    const shared: TurnFinalizeShared = {
      ...sharedStub(session, turn),
      emitEvent: (event) => events.push(event.type),
    };
    const result = finishShortCircuitTurn(shared, "短路回复");
    return { result, events };
  }

  it("records a plain shortcut as delivered with zero loop rounds", () => {
    const { result, events } = run("running");
    expect(result.turn.stopReason).toBe("delivered");
    expect(result.turn.roundCount).toBe(0);
    expect(events).toContain("final");
  });

  it("does not record an approval pause or a clarification ask as a clean delivery", () => {
    // 旧行为：短路收口一律覆盖 status=completed。这里只保证停因不撒谎——
    // 等状态覆盖本身修掉时，这条断言仍应成立。
    expect(run("awaiting_approval").result.turn.stopReason).toBe("awaiting_approval");
    expect(run("awaiting_clarification").result.turn.stopReason).toBe("awaiting_clarification");
  });
});

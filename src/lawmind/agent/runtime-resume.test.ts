import { describe, expect, it, vi, beforeEach } from "vitest";
import { resumePausedTurn, resumeTurn } from "./runtime-resume.js";
import * as runtimeMod from "./runtime.js";
import * as sessionMod from "./session.js";
import type { AgentConfig, AgentSession } from "./types.js";

describe("resumeTurn editedArgs", () => {
  const workspaceDir = "/tmp/lm-resume-test";
  const sessionId = "sess-1";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes editedArgs as preApproveToolArgs on edit decision", async () => {
    const session: AgentSession = {
      sessionId,
      matterId: "matter-a",
      conversationHistory: [],
      turns: [
        {
          turnId: "turn-1",
          sessionId,
          instruction: "run",
          messages: [],
          toolCallsExecuted: 0,
          status: "awaiting_approval",
          startedAt: new Date().toISOString(),
          requiresAction: [
            {
              id: "ra-1",
              kind: "tool_approval",
              threadId: "t:1",
              title: "approve",
              toolName: "execute_workflow",
              toolArgs: { workflowId: "old" },
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ],
      pendingRequiresAction: [
        {
          id: "ra-1",
          kind: "tool_approval",
          threadId: "t:1",
          title: "approve",
          toolName: "execute_workflow",
          toolArgs: { workflowId: "old" },
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(sessionMod, "loadSession").mockReturnValue(session);
    vi.spyOn(sessionMod, "saveSession").mockImplementation(() => {});

    const runTurnSpy = vi.spyOn(runtimeMod, "runTurn").mockResolvedValue({
      turn: session.turns[0],
      reply: "ok",
      sessionId,
      memoryContext: { layers: [] },
    });

    const config = { workspaceDir } as AgentConfig;
    const registry = { list: () => [], get: () => undefined } as never;

    await resumeTurn(
      config,
      registry,
      {
        sessionId,
        actionId: "ra-1",
        decision: "edit",
        editedArgs: { workflowId: "new", __approved: true },
      },
      {},
    );

    expect(runTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        preApproveToolName: "execute_workflow",
        preApproveToolArgs: { workflowId: "new", __approved: true },
      }),
    );
  });
});

describe("resumeTurn continue_tools", () => {
  const workspaceDir = "/tmp/lm-resume-continue";
  const sessionId = "sess-continue";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("approving continue_tools resumes with skipToolBudgetCheckpoint", async () => {
    const session: AgentSession = {
      sessionId,
      matterId: "matter-a",
      conversationHistory: [],
      turns: [],
      pendingRequiresAction: [
        {
          id: "ra-c",
          kind: "continue_tools",
          threadId: "t:1",
          title: "本轮步骤较多",
          summary: "继续？",
          toolCallsExecuted: 40,
          decisions: ["approve", "reject"],
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.spyOn(sessionMod, "loadSession").mockReturnValue(session);
    vi.spyOn(sessionMod, "saveSession").mockImplementation(() => {});
    const runTurnSpy = vi.spyOn(runtimeMod, "runTurn").mockResolvedValue({
      turn: {
        turnId: "t",
        sessionId,
        instruction: "",
        messages: [],
        toolCallsExecuted: 40,
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      reply: "ok",
      sessionId,
      memoryContext: { layers: [] },
    });

    await resumeTurn(
      { workspaceDir } as AgentConfig,
      { list: () => [], get: () => undefined } as never,
      { sessionId, actionId: "ra-c", decision: "approve" },
      {},
    );

    expect(runTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        skipToolBudgetCheckpoint: true,
        initialToolCallsExecuted: 40,
      }),
    );
  });

  it("继续本件：中断轮次没有落盘待办时也按 id 找回，并带出原指令", async () => {
    const interrupted: AgentSession = {
      sessionId,
      matterId: "matter-a",
      conversationHistory: [],
      turns: [
        {
          turnId: "turn-interrupted",
          sessionId,
          instruction: "按国浩批注改这份合作协议，出审阅痕迹稿",
          messages: [],
          toolCallsExecuted: 11,
          status: "running",
          startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const loaded = { current: interrupted };
    vi.spyOn(sessionMod, "loadSession").mockImplementation(() => loaded.current);
    const saveSpy = vi.spyOn(sessionMod, "saveSession").mockImplementation(() => {});
    const runTurnSpy = vi.spyOn(runtimeMod, "runTurn").mockResolvedValue({
      turn: {
        turnId: "t-next",
        sessionId,
        instruction: "",
        messages: [],
        toolCallsExecuted: 0,
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      reply: "ok",
      sessionId,
      memoryContext: { layers: [] },
    });

    await resumeTurn(
      { workspaceDir } as AgentConfig,
      { list: () => [], get: () => undefined } as never,
      { sessionId, actionId: "interrupted:turn-interrupted", decision: "approve" },
      {},
    );

    const call = runTurnSpy.mock.calls[0]?.[0] as {
      instruction: string;
      initialToolCallsExecuted?: number;
    };
    expect(call.instruction).toContain("【从检查点继续】");
    expect(call.instruction).toContain("按国浩批注改这份合作协议");
    expect(call.initialToolCallsExecuted).toBe(11);
    // 中断占位轮次被收口，不再派生卡片
    expect(loaded.current.turns[0]?.status).toBe("completed");
    expect(saveSpy).toHaveBeenCalled();
  });

  it("弃办：中断标签的卡片拒绝后本件收口且不再派生", async () => {
    const interrupted: AgentSession = {
      sessionId,
      matterId: "matter-a",
      conversationHistory: [],
      turns: [
        {
          turnId: "turn-interrupted",
          sessionId,
          instruction: "按批注改这份合同",
          messages: [],
          toolCallsExecuted: 3,
          status: "running",
          startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.spyOn(sessionMod, "loadSession").mockReturnValue(interrupted);
    vi.spyOn(sessionMod, "saveSession").mockImplementation(() => {});
    const runTurnSpy = vi.spyOn(runtimeMod, "runTurn");

    const result = await resumeTurn(
      { workspaceDir } as AgentConfig,
      { list: () => [], get: () => undefined } as never,
      { sessionId, actionId: "interrupted:turn-interrupted", decision: "reject" },
      {},
    );

    expect(runTurnSpy).not.toHaveBeenCalled();
    expect(result.reply).toContain("弃办");
    expect(interrupted.turns[0]?.status).toBe("completed");
  });
});

describe("resumePausedTurn", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("continues from last paused turn with checkpoint instruction", async () => {
    const sessionId = "sess-paused";
    const session: AgentSession = {
      sessionId,
      matterId: "matter-a",
      conversationHistory: [],
      turns: [
        {
          turnId: "turn-p",
          sessionId,
          instruction: "审查这份合同",
          messages: [
            {
              role: "assistant",
              content: "",
              timestamp: new Date().toISOString(),
              toolCalls: [{ id: "t1", name: "analyze_document", arguments: "{}" }],
            },
          ],
          toolCallsExecuted: 2,
          status: "paused",
          startedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.spyOn(sessionMod, "loadSession").mockReturnValue(session);
    const runTurnSpy = vi.spyOn(runtimeMod, "runTurn").mockResolvedValue({
      turn: session.turns[0],
      reply: "continued",
      sessionId,
      memoryContext: {} as never,
    });
    const config = {
      workspaceDir: "/tmp/lm-resume-paused",
      model: { provider: "openai-compatible", baseUrl: "http://x", apiKey: "k", model: "m" },
    } as AgentConfig;

    await resumePausedTurn(config, {} as never, sessionId, {});

    expect(runTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        instruction: expect.stringContaining("【从检查点继续】"),
        initialToolCallsExecuted: 2,
      }),
    );
    expect(runTurnSpy.mock.calls[0]?.[0]?.instruction).toContain("审查这份合同");
  });
});

describe("resumeTurn clarification answers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("persists lawyer-confirmed answers for the Guardian evidence pack", async () => {
    const sessionId = "sess-clarify";
    const session: AgentSession = {
      sessionId,
      matterId: "matter-a",
      actorId: "t",
      conversationHistory: [],
      turns: [],
      pendingRequiresAction: [
        {
          id: "ra-q",
          kind: "clarification",
          threadId: "t:1",
          title: "待确认",
          summary: "立场",
          clarificationQuestions: [{ key: "stance", question: "己方立场？", required: true }],
          decisions: ["respond"],
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.spyOn(sessionMod, "loadSession").mockReturnValue(session);
    const saveSpy = vi.spyOn(sessionMod, "saveSession").mockImplementation(() => {});
    const runTurnSpy = vi.spyOn(runtimeMod, "runTurn").mockResolvedValue({
      turn: {
        turnId: "t",
        sessionId,
        instruction: "",
        messages: [],
        toolCallsExecuted: 0,
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      reply: "ok",
      sessionId,
      memoryContext: { layers: [] },
    });

    await resumeTurn(
      { workspaceDir: "/tmp/lm-resume-clarify" } as AgentConfig,
      { list: () => [], get: () => undefined } as never,
      {
        sessionId,
        actionId: "ra-q",
        decision: "respond",
        clarificationAnswers: { stance: "甲方" },
      },
      {},
    );

    expect(session.lastConfirmedAnswers).toEqual({ stance: "甲方" });
    expect(saveSpy).toHaveBeenCalled();
    expect(runTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedAnswers: { stance: "甲方" },
      }),
    );
  });
});

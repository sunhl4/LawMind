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
      }),
    );
    expect(runTurnSpy.mock.calls[0]?.[0]?.instruction).toContain("审查这份合同");
  });
});

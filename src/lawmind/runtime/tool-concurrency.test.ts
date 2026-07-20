import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../agent/tools/registry.js";
import { executeToolBatches } from "../agent/turn-orchestrator-tool-round.js";
import type { AgentTool } from "../agent/types.js";
import type { AgentContext, AgentTurn } from "../agent/types.js";
import { isToolConcurrencySafe, partitionToolCalls } from "./tool-concurrency.js";

function stubTool(
  name: string,
  opts?: { isConcurrencySafe?: boolean; requiresApproval?: boolean },
): AgentTool {
  return {
    definition: {
      name,
      description: name,
      category: "search",
      parameters: {},
      isConcurrencySafe: opts?.isConcurrencySafe,
      requiresApproval: opts?.requiresApproval,
    },
    execute: async () => ({ ok: true }),
  };
}

describe("partitionToolCalls", () => {
  it("groups consecutive safe tools", () => {
    const registry = new ToolRegistry();
    registry.register(stubTool("search_workspace", { isConcurrencySafe: true }));
    registry.register(stubTool("read_project_file", { isConcurrencySafe: true }));
    registry.register(stubTool("draft_document", { isConcurrencySafe: false }));

    const batches = partitionToolCalls(
      [
        { id: "1", name: "search_workspace", arguments: {} },
        { id: "2", name: "read_project_file", arguments: {} },
        { id: "3", name: "draft_document", arguments: {} },
      ],
      registry,
    );
    expect(batches).toHaveLength(2);
    expect(batches[0]?.concurrencySafe).toBe(true);
    expect(batches[0]?.calls).toHaveLength(2);
    expect(batches[1]?.concurrencySafe).toBe(false);
  });

  it("never treats requiresApproval tools as concurrency-safe", () => {
    const registry = new ToolRegistry();
    registry.register(
      stubTool("dangerous_write", { isConcurrencySafe: true, requiresApproval: true }),
    );
    expect(isToolConcurrencySafe(registry, "dangerous_write")).toBe(false);
  });
});

describe("executeToolBatches approval race", () => {
  it("first-wins when two concurrent tools return pendingApproval", async () => {
    const registry = new ToolRegistry();
    let calls = 0;
    const makePending = (name: string): AgentTool => ({
      definition: {
        name,
        description: name,
        category: "system",
        parameters: {},
        isConcurrencySafe: true,
      },
      execute: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, name === "tool_a" ? 1 : 20));
        return { ok: true, pendingApproval: true };
      },
    });
    registry.register(makePending("tool_a"));
    registry.register(makePending("tool_b"));

    const turn: AgentTurn = {
      turnId: "t1",
      sessionId: "s1",
      instruction: "x",
      messages: [],
      toolCallsExecuted: 0,
      status: "running",
      gateDecisions: [],
      startedAt: new Date().toISOString(),
    };
    const ctx = {
      workspaceDir: "/tmp",
    } as AgentContext;

    const result = await executeToolBatches({
      toolRefs: [
        { id: "a", name: "tool_a", arguments: {} },
        { id: "b", name: "tool_b", arguments: {} },
      ],
      registry,
      turn,
      ctx,
      roundIndex: 1,
      assistantContent: "need approve",
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

    expect(result.stoppedForApproval).toBe(true);
    expect(turn.status).toBe("awaiting_approval");
    expect(calls).toBe(2);
    // tool_a finishes first → first-wins keeps tool_a
    expect(turn.pendingToolApproval?.toolCallId).toBe("a");
    expect(turn.pendingToolApproval?.toolName).toBe("tool_a");
  });
});

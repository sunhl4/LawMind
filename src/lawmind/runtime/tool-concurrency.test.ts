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
  it("first-wins when two concurrent tools return approvalRequest", async () => {
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
        return { ok: true, approvalRequest: true };
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

  it("skips tools that have not started after Stop, and still writes tool results", async () => {
    const registry = new ToolRegistry();
    const ran: string[] = [];
    const makeTool = (name: string): AgentTool => ({
      definition: {
        name,
        description: name,
        category: "system",
        parameters: {},
      },
      execute: async () => {
        ran.push(name);
        return { ok: true };
      },
    });
    registry.register(makeTool("tool_first"));
    registry.register(makeTool("tool_second"));

    const turn: AgentTurn = {
      turnId: "t-abort",
      sessionId: "s1",
      instruction: "x",
      messages: [],
      toolCallsExecuted: 0,
      status: "running",
      gateDecisions: [],
      startedAt: new Date().toISOString(),
    };
    const abort = new AbortController();
    const ctx = {
      workspaceDir: "/tmp",
      abortSignal: abort.signal,
    } as AgentContext;
    const pushed: Array<{ name?: string; ok?: boolean }> = [];

    abort.abort();
    await executeToolBatches({
      toolRefs: [
        { id: "a", name: "tool_first", arguments: {} },
        { id: "b", name: "tool_second", arguments: {} },
      ],
      registry,
      turn,
      ctx,
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
        const tr = msg.toolCallResponses?.[0];
        pushed.push({ name: tr?.name, ok: tr?.result.ok });
      },
      abortRequested: () => true,
    });

    expect(ran).toEqual([]);
    expect(turn.toolCallsExecuted).toBe(0);
    expect(pushed).toEqual([
      { name: "tool_first", ok: false },
      { name: "tool_second", ok: false },
    ]);
  });

  it("does not publish any tool result until the concurrent batch finishes", async () => {
    const registry = new ToolRegistry();
    const pushedDuring = { a: 0, b: 0 };
    let pushed = 0;
    registry.register({
      definition: {
        name: "search_ok",
        description: "ok",
        category: "search",
        parameters: {},
        isConcurrencySafe: true,
      },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 15));
        pushedDuring.a = pushed;
        return { ok: true, data: { hit: 1 } };
      },
    });
    registry.register({
      definition: {
        name: "needs_ok",
        description: "pending",
        category: "search",
        parameters: {},
        isConcurrencySafe: true,
      },
      execute: async () => {
        pushedDuring.b = pushed;
        return { ok: true, approvalRequest: true };
      },
    });
    const turn: AgentTurn = {
      turnId: "t-hold",
      sessionId: "s1",
      instruction: "x",
      messages: [],
      toolCallsExecuted: 0,
      status: "running",
      gateDecisions: [],
      startedAt: new Date().toISOString(),
    };
    const names: string[] = [];
    const result = await executeToolBatches({
      toolRefs: [
        { id: "a", name: "search_ok", arguments: {} },
        { id: "b", name: "needs_ok", arguments: {} },
      ],
      registry,
      turn,
      ctx: { workspaceDir: "/tmp" } as AgentContext,
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
        pushed += 1;
        names.push(msg.toolCallResponses?.[0]?.name ?? "");
      },
    });
    expect(pushedDuring.a).toBe(0);
    expect(pushedDuring.b).toBe(0);
    expect(result.heldForElicitation).toBe(true);
    expect(result.stoppedForApproval).toBe(true);
    expect(names).toEqual(["search_ok", "needs_ok"]);
    expect(turn.pendingToolApproval?.toolName).toBe("needs_ok");
  });

  it("publishes clarification results only after the whole batch returns", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "search_ok",
        description: "ok",
        category: "search",
        parameters: {},
        isConcurrencySafe: true,
      },
      execute: async () => ({ ok: true }),
    });
    registry.register({
      definition: {
        name: "ask_more",
        description: "clarify",
        category: "draft",
        parameters: {},
        isConcurrencySafe: true,
      },
      execute: async () => ({
        ok: true,
        data: {
          deliveryReadiness: "draft_with_placeholders",
          clarificationQuestions: [{ key: "amount", question: "合同金额？" }],
        },
      }),
    });
    const turn: AgentTurn = {
      turnId: "t-clar",
      sessionId: "s1",
      instruction: "x",
      messages: [],
      toolCallsExecuted: 0,
      status: "running",
      gateDecisions: [],
      startedAt: new Date().toISOString(),
    };
    const pushed: string[] = [];
    const result = await executeToolBatches({
      toolRefs: [
        { id: "a", name: "search_ok", arguments: {} },
        { id: "b", name: "ask_more", arguments: {} },
      ],
      registry,
      turn,
      ctx: { workspaceDir: "/tmp" } as AgentContext,
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
        pushed.push(msg.toolCallResponses?.[0]?.name ?? "");
      },
    });
    expect(result.heldForElicitation).toBe(true);
    expect(pushed).toEqual(["search_ok", "ask_more"]);
    expect(turn.status).toBe("running");
    expect(result.pendingClarificationQuestions).toHaveLength(1);
  });
});

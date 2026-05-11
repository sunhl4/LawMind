/**
 * Tool pipeline 中间件单测 — W2。
 *
 * 每个中间件单独覆盖一个拒绝路径，确保拆分后行为与原 runtime.ts 一致。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AgentContext, AgentTool, ToolCallResult, ToolDefinition } from "../agent/types.js";
import {
  approvalMiddleware,
  argSchemaMiddleware,
  budgetMiddleware,
  buildDefaultToolPipeline,
  clarificationGateMiddleware,
  composeToolPipeline,
  executeMiddleware,
  roleAllowlistMiddleware,
  timeoutMiddleware,
  unknownToolMiddleware,
  type ToolCallContext,
  type ToolMiddleware,
  type ToolPolicyConfig,
} from "./tool-pipeline.js";

const baseDef: ToolDefinition = {
  name: "test_tool",
  description: "test tool",
  parameters: {
    query: { type: "string", required: true, description: "query" },
  },
};

function buildAgentContext(workspaceDir: string): AgentContext {
  return {
    workspaceDir,
    sessionId: "session-1",
    matterId: undefined,
    actorId: "actor",
    assistantId: undefined,
    projectDir: undefined,
    allowWebSearch: false,
    collaborationEnabled: false,
    clarificationBlockingHeavyTools: false,
    strictDangerousToolApproval: false,
  };
}

function buildPolicy(
  workspaceDir: string,
  override: Partial<ToolPolicyConfig> = {},
): ToolPolicyConfig {
  return {
    usedToolCalls: 1,
    maxToolCalls: 5,
    toolTimeoutMs: 5_000,
    strictDangerousToolApproval: false,
    allowDangerousToolsWithoutApproval: false,
    actorId: "actor",
    auditDir: path.join(workspaceDir, "audit"),
    ...override,
  };
}

function buildCall(
  workspaceDir: string,
  options: {
    tool?: AgentTool;
    args?: Record<string, unknown>;
    policyOverride?: Partial<ToolPolicyConfig>;
    ctxOverride?: Partial<AgentContext>;
    toolName?: string;
  } = {},
): ToolCallContext {
  const ctx = { ...buildAgentContext(workspaceDir), ...options.ctxOverride };
  return {
    toolCallId: "call-1",
    toolName: options.toolName ?? options.tool?.definition.name ?? "test_tool",
    args: options.args ?? { query: "x" },
    tool: options.tool,
    ctx,
    turn: { turnId: "turn-1" },
    policy: buildPolicy(workspaceDir, options.policyOverride),
  };
}

describe("tool-pipeline composeToolPipeline", () => {
  it("runs middlewares in order and short-circuits when one returns without next()", async () => {
    const ran: string[] = [];
    const a: ToolMiddleware = async (_call, next) => {
      ran.push("a-pre");
      const r = await next();
      ran.push("a-post");
      return r;
    };
    const b: ToolMiddleware = async () => {
      ran.push("b-final");
      return { ok: true, data: 42 };
    };
    const run = composeToolPipeline([a, b]);
    const result = await run(buildCall("/tmp"));
    expect(result.ok).toBe(true);
    expect(result.data).toBe(42);
    expect(ran).toEqual(["a-pre", "b-final", "a-post"]);
  });

  it("returns error when pipeline exhausted without execute", async () => {
    const passthrough: ToolMiddleware = async (_call, next) => next();
    const run = composeToolPipeline([passthrough]);
    const result = await run(buildCall("/tmp"));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pipeline exhausted/);
  });
});

describe("tool-pipeline middlewares", () => {
  let workspaceDir: string;
  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-pipeline-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("unknownToolMiddleware rejects when tool missing", async () => {
    const result = await unknownToolMiddleware(buildCall(workspaceDir), async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });

  it("budgetMiddleware rejects when usedToolCalls > maxToolCalls", async () => {
    const call = buildCall(workspaceDir, { policyOverride: { usedToolCalls: 6, maxToolCalls: 5 } });
    const result = await budgetMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Tool budget exhausted/);
  });

  it("roleAllowlistMiddleware rejects when tool not in allowlist", async () => {
    const call = buildCall(workspaceDir, {
      policyOverride: { allowedToolNames: ["other_tool"] },
    });
    const result = await roleAllowlistMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not allowed for current role/);
  });

  it("clarificationGateMiddleware rejects heavy tools when blocking", async () => {
    const call = buildCall(workspaceDir, {
      toolName: "research_task",
      ctxOverride: { clarificationBlockingHeavyTools: true },
    });
    const result = await clarificationGateMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/待澄清/);
  });

  it("approvalMiddleware demands __approved for dangerous tools", async () => {
    const tool: AgentTool = {
      definition: { ...baseDef, requiresApproval: true },
      execute: async () => ({ ok: true }),
    };
    const call = buildCall(workspaceDir, { tool, args: { query: "x" } });
    const result = await approvalMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.pendingApproval).toBe(true);
  });

  it("argSchemaMiddleware rejects invalid args", async () => {
    const tool: AgentTool = {
      definition: baseDef,
      execute: async () => ({ ok: true }),
    };
    const call = buildCall(workspaceDir, { tool, args: { unexpected: 1 } });
    const result = await argSchemaMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid arguments/);
  });

  it("timeoutMiddleware rejects when tool exceeds timeout (audit catches downstream)", async () => {
    const call = buildCall(workspaceDir, { policyOverride: { toolTimeoutMs: 50 } });
    const slow: ToolMiddleware = async () =>
      new Promise<ToolCallResult>((resolve) => setTimeout(() => resolve({ ok: true }), 200));
    await expect(
      timeoutMiddleware(call, () => slow(call, async () => ({ ok: true }))),
    ).rejects.toThrow(/timed out/);
  });

  it("executeMiddleware invokes tool.execute and returns its result", async () => {
    const tool: AgentTool = {
      definition: baseDef,
      execute: async (args) => ({ ok: true, data: args.query }),
    };
    const call = buildCall(workspaceDir, { tool, args: { query: "hello" } });
    const result = await executeMiddleware(call, async () => ({ ok: false }));
    expect(result.ok).toBe(true);
    expect(result.data).toBe("hello");
  });

  it("executeMiddleware wraps thrown errors", async () => {
    const tool: AgentTool = {
      definition: baseDef,
      execute: async () => {
        throw new Error("boom");
      },
    };
    const call = buildCall(workspaceDir, { tool });
    const result = await executeMiddleware(call, async () => ({ ok: false }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Tool error.*boom/);
  });

  it("buildDefaultToolPipeline runs end-to-end happy path", async () => {
    const tool: AgentTool = {
      definition: baseDef,
      execute: async (args) => ({ ok: true, data: args.query }),
    };
    const run = composeToolPipeline(buildDefaultToolPipeline());
    const call = buildCall(workspaceDir, { tool, args: { query: "ok" } });
    const result = await run(call);
    expect(result.ok).toBe(true);
    expect(result.data).toBe("ok");
  });
});

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
  subprocessSandboxMiddleware,
  matterScopeMiddleware,
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

  it("clarificationGateMiddleware rejects write tools when blocking", async () => {
    const call = buildCall(workspaceDir, {
      toolName: "draft_document",
      ctxOverride: { clarificationBlockingHeavyTools: true },
    });
    const result = await clarificationGateMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/待澄清/);
  });

  it("clarificationGateMiddleware allows research_task while clarification pending", async () => {
    const call = buildCall(workspaceDir, {
      toolName: "research_task",
      ctxOverride: { clarificationBlockingHeavyTools: true },
    });
    const result = await clarificationGateMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(true);
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

  it("argSchemaMiddleware strips unknown args instead of failing", async () => {
    const tool: AgentTool = {
      definition: baseDef,
      execute: async () => ({ ok: true, data: { ran: true } }),
    };
    const call = buildCall(workspaceDir, {
      tool,
      args: { query: "ok", unexpected: 1 },
    });
    const result = await argSchemaMiddleware(call, async () => ({
      ok: true,
      data: { ran: true },
    }));
    expect(result.ok).toBe(true);
    expect(call.args.unexpected).toBeUndefined();
    expect((result.data as { argNote?: string }).argNote).toMatch(/unexpected/);
  });

  it("argSchemaMiddleware still rejects missing required args", async () => {
    const tool: AgentTool = {
      definition: baseDef,
      execute: async () => ({ ok: true }),
    };
    const call = buildCall(workspaceDir, { tool, args: {} });
    const result = await argSchemaMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid arguments|missing required/);
  });

  it("timeoutMiddleware rejects when tool exceeds timeout (audit catches downstream)", async () => {
    const call = buildCall(workspaceDir, { policyOverride: { toolTimeoutMs: 50 } });
    const slow: ToolMiddleware = async () =>
      new Promise<ToolCallResult>((resolve) => setTimeout(() => resolve({ ok: true }), 200));
    await expect(
      timeoutMiddleware(call, () => slow(call, async () => ({ ok: true }))),
    ).rejects.toThrow(/timed out/);
  });

  it("subprocessSandboxMiddleware bypasses next when sandbox disabled", async () => {
    let nextCalled = false;
    const call = buildCall(workspaceDir, {
      toolName: "render_document",
      policyOverride: { toolSandboxEnabled: false },
    });
    const result = await subprocessSandboxMiddleware(call, async () => {
      nextCalled = true;
      return { ok: true, data: "inline" };
    });
    expect(nextCalled).toBe(true);
    expect(result.data).toBe("inline");
  });

  it("subprocessSandboxMiddleware runs inline sandbox for high-risk tools when enabled", async () => {
    const tool: AgentTool = {
      definition: {
        name: "add_case_note",
        description: "note",
        parameters: { note: { type: "string", required: true, description: "n" } },
      },
      execute: async () => ({ ok: false, error: "should not run in parent" }),
    };
    const call = buildCall(workspaceDir, {
      tool,
      toolName: "add_case_note",
      args: { note: "test", matterId: "m1" },
      policyOverride: { toolSandboxEnabled: true },
    });
    const result = await subprocessSandboxMiddleware(call, async () => ({
      ok: false,
      error: "next should not run",
    }));
    expect(result.sandboxed).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).not.toBe("next should not run");
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

  it("matterScopeMiddleware blocks matter tools without matterId", async () => {
    const tool: AgentTool = {
      definition: { ...baseDef, name: "search_matter" },
      execute: async () => ({ ok: true }),
    };
    const call = buildCall(workspaceDir, {
      tool,
      toolName: "search_matter",
      args: { query: "x" },
      ctxOverride: { matterId: undefined },
    });
    const result = await matterScopeMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/绑定案件/);
  });

  it("matterScopeMiddleware allows matter_id in args", async () => {
    const tool: AgentTool = {
      definition: { ...baseDef, name: "search_matter" },
      execute: async () => ({ ok: true, data: "hit" }),
    };
    const call = buildCall(workspaceDir, {
      tool,
      toolName: "search_matter",
      args: { query: "x", matter_id: "case-1" },
      ctxOverride: { matterId: undefined },
    });
    const result = await matterScopeMiddleware(call, async () => ({ ok: true, data: "hit" }));
    expect(result.ok).toBe(true);
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

  it("normalizes write_document path alias before schema validation", async () => {
    const tool: AgentTool = {
      definition: {
        name: "write_document",
        description: "write",
        category: "draft",
        parameters: {
          file_path: { type: "string", description: "path", required: true },
          content: { type: "string", description: "body", required: true },
        },
      },
      execute: async (args) => ({ ok: true, data: args }),
    };
    const run = composeToolPipeline(buildDefaultToolPipeline());
    const call = buildCall(workspaceDir, {
      tool,
      toolName: "write_document",
      args: { path: "notes/x.md", content: "hello" },
    });
    const result = await run(call);
    expect(result.ok).toBe(true);
    expect((result.data as { file_path?: string }).file_path).toBe("notes/x.md");
  });
});

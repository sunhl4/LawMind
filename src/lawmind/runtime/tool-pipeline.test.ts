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
  discoveryLoopMiddleware,
  dropSaturatedDiscoveryTools,
  wouldHitDiscoveryCap,
  executeMiddleware,
  subprocessSandboxMiddleware,
  matterScopeMiddleware,
  permissionModeMiddleware,
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
    expect(result.error).toMatch(/未知工具/);
  });

  it("budgetMiddleware rejects when usedToolCalls > maxToolCalls", async () => {
    const call = buildCall(workspaceDir, { policyOverride: { usedToolCalls: 6, maxToolCalls: 5 } });
    const result = await budgetMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Tool budget exhausted/);
  });

  it("permissionModeMiddleware hard-blocks a write tool in readonly mode (ad-list bypass)", async () => {
    // 对抗场景：模型（或被注入的模型）绕过工具广告清单直接点名写工具——
    // 工具已注册、参数合法，管线仍必须在执行层拦截，tool.execute 不得被调用。
    let executed = false;
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
      execute: async () => {
        executed = true;
        return { ok: true };
      },
    };
    const run = composeToolPipeline(buildDefaultToolPipeline());
    const result = await run(
      buildCall(workspaceDir, {
        tool,
        toolName: "write_document",
        args: { file_path: "x.md", content: "hi" },
        ctxOverride: { permissionMode: "readonly" },
      }),
    );
    expect(result.ok).toBe(false);
    expect(executed).toBe(false);
    expect(result.error).toContain("只读");
    expect(result.error).toContain("write_document");
    expect(result.error).toContain("标准");
    const gate = (result.data as { gateDecision?: Record<string, unknown> } | undefined)
      ?.gateDecision;
    expect(gate?.gate).toBe("dangerous_tool_gate");
    expect(gate?.decision).toBe("block");
    expect(gate?.category).toBe("safety_hard");
  });

  it("permissionModeMiddleware blocks write tools in research mode but allows research_task", async () => {
    const blocked = await permissionModeMiddleware(
      buildCall(workspaceDir, {
        toolName: "render_document",
        ctxOverride: { permissionMode: "research" },
      }),
      async () => ({ ok: true }),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("研究");
    expect(blocked.error).toContain("render_document");

    let nextCalled = false;
    const allowed = await permissionModeMiddleware(
      buildCall(workspaceDir, {
        toolName: "research_task",
        ctxOverride: { permissionMode: "research" },
      }),
      async () => {
        nextCalled = true;
        return { ok: true };
      },
    );
    expect(nextCalled).toBe(true);
    expect(allowed.ok).toBe(true);
  });

  it("permissionModeMiddleware lets read tools run in readonly mode", async () => {
    const tool: AgentTool = {
      definition: { ...baseDef, name: "calculate" },
      execute: async () => ({ ok: true, data: 42 }),
    };
    const run = composeToolPipeline(buildDefaultToolPipeline());
    const result = await run(
      buildCall(workspaceDir, {
        tool,
        toolName: "calculate",
        ctxOverride: { permissionMode: "readonly" },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.data).toBe(42);
  });

  it("permissionModeMiddleware does not restrict standard/strict/unset modes", async () => {
    for (const mode of ["standard", "strict"] as const) {
      let nextCalled = false;
      const result = await permissionModeMiddleware(
        buildCall(workspaceDir, {
          toolName: "write_document",
          ctxOverride: { permissionMode: mode },
        }),
        async () => {
          nextCalled = true;
          return { ok: true };
        },
      );
      expect(nextCalled).toBe(true);
      expect(result.ok).toBe(true);
    }
    // 旧式 ctx（未带 permissionMode 字段）按 standard 放行。
    let legacyNext = false;
    const legacy = await permissionModeMiddleware(
      buildCall(workspaceDir, { toolName: "write_document" }),
      async () => {
        legacyNext = true;
        return { ok: true };
      },
    );
    expect(legacyNext).toBe(true);
    expect(legacy.ok).toBe(true);
  });

  it("discoveryLoopMiddleware caps search_workspace repeats", async () => {
    const ok = await discoveryLoopMiddleware(
      buildCall(workspaceDir, {
        toolName: "search_workspace",
        policyOverride: { toolNameCallCounts: { search_workspace: 0 } },
      }),
      async () => ({ ok: true }),
    );
    expect(ok.ok).toBe(true);
    const blocked = await discoveryLoopMiddleware(
      buildCall(workspaceDir, {
        toolName: "search_workspace",
        policyOverride: { toolNameCallCounts: { search_workspace: 1 } },
      }),
      async () => ({ ok: true }),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/search_workspace/);
    expect(blocked.error).toMatch(/正确根目录|read_project_file|不要反复/);
  });

  it("discoveryLoopMiddleware uses Word-revision hint, not mail outbound", async () => {
    const blocked = await discoveryLoopMiddleware(
      buildCall(workspaceDir, {
        toolName: "search_workspace",
        policyOverride: {
          toolNameCallCounts: { search_workspace: 1 },
          allowlistDenyHint: "本回合是原 Word 改稿：请按通读 → seed 基线执行。不要准备外发邮件。",
        },
      }),
      async () => ({ ok: true }),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("read_project_file");
    expect(blocked.error).toContain("不要 prepare_outbound_mail");
    expect(blocked.error).not.toContain("自动办件");
  });

  it("discoveryLoopMiddleware tells the model to draft after a successful Word read", async () => {
    const blocked = await discoveryLoopMiddleware(
      buildCall(workspaceDir, {
        toolName: "analyze_document",
        policyOverride: {
          toolNameCallCounts: { analyze_document: 1 },
          allowlistDenyHint: "本回合是原 Word 改稿：请按通读 → seed 基线执行。不要准备外发邮件。",
        },
      }),
      async () => ({ ok: true }),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("文书已通读");
    expect(blocked.error).toContain("不要再 analyze_document");
    expect(blocked.error).not.toContain("自动办件");
  });

  it("wouldHitDiscoveryCap and dropSaturatedDiscoveryTools match the middleware quota", () => {
    expect(wouldHitDiscoveryCap("analyze_document", {})).toBe(false);
    expect(wouldHitDiscoveryCap("analyze_document", { analyze_document: 1 })).toBe(true);
    expect(wouldHitDiscoveryCap("update_draft", { analyze_document: 1 })).toBe(false);
    expect(
      dropSaturatedDiscoveryTools(["analyze_document", "read_project_file", "update_draft"], {
        analyze_document: 1,
      }),
    ).toEqual(["read_project_file", "update_draft"]);
    expect(
      dropSaturatedDiscoveryTools(
        ["analyze_document", "read_project_file", "update_draft"],
        { analyze_document: 1 },
        { dropDocumentReaders: true },
      ),
    ).toEqual(["update_draft"]);
  });

  it("discoveryLoopMiddleware enforces total discovery cap", async () => {
    const blocked = await discoveryLoopMiddleware(
      buildCall(workspaceDir, {
        toolName: "read_project_file",
        policyOverride: {
          toolNameCallCounts: {
            search_workspace: 1,
            search_matter: 1,
            get_matter_summary: 1,
            analyze_document: 1,
          },
        },
      }),
      async () => ({ ok: true }),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/合计/);
  });

  it("roleAllowlistMiddleware rejects when tool not in allowlist", async () => {
    const call = buildCall(workspaceDir, {
      policyOverride: { allowedToolNames: ["other_tool"] },
    });
    const result = await roleAllowlistMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/当前办件不能使用/);
  });

  it("roleAllowlistMiddleware appends the playbook deny hint", async () => {
    const call = buildCall(workspaceDir, {
      toolName: "search_workspace",
      policyOverride: {
        allowedToolNames: ["analyze_document"],
        allowlistDenyHint: "不要再检索案卷。",
      },
    });
    const result = await roleAllowlistMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("search_workspace");
    expect(result.error).toContain("不要再检索案卷");
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

  it("approvalMiddleware demands __approved for send_email", async () => {
    const tool: AgentTool = {
      definition: { ...baseDef, name: "send_email", requiresApproval: true },
      execute: async () => ({ ok: true }),
    };
    const call = buildCall(workspaceDir, { tool, args: { query: "x" } });
    const result = await approvalMiddleware(call, async () => ({ ok: true }));
    expect(result.ok).toBe(false);
    expect(result.approvalRequest).toBe(true);
  });

  it("approvalMiddleware does not pause internal production tools", async () => {
    const tool: AgentTool = {
      definition: {
        ...baseDef,
        name: "render_document",
        requiresApproval: true,
        riskLevel: "high",
      },
      execute: async () => ({ ok: true }),
    };
    const result = await approvalMiddleware(
      buildCall(workspaceDir, {
        tool,
        policyOverride: { riskCeiling: "medium", strictDangerousToolApproval: true },
      }),
      async () => ({ ok: true }),
    );
    expect(result.ok).toBe(true);
  });

  it("approvalMiddleware enforces riskCeiling only for outbound send", async () => {
    const highRiskTool: AgentTool = {
      definition: { ...baseDef, name: "send_email", riskLevel: "high" },
      execute: async () => ({ ok: true }),
    };
    const blocked = await approvalMiddleware(
      buildCall(workspaceDir, {
        tool: highRiskTool,
        policyOverride: { riskCeiling: "medium" },
      }),
      async () => ({ ok: true }),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.approvalRequest).toBe(true);

    // 发信即使风险上限够高也仍要拍板。
    const stillPaused = await approvalMiddleware(
      buildCall(workspaceDir, {
        tool: highRiskTool,
        policyOverride: { riskCeiling: "high" },
      }),
      async () => ({ ok: true }),
    );
    expect(stillPaused.ok).toBe(false);
    expect(stillPaused.approvalRequest).toBe(true);

    // ceiling=medium 但律师已 __approved → 放行。
    const approved = await approvalMiddleware(
      buildCall(workspaceDir, {
        tool: highRiskTool,
        args: { query: "x", __approved: true },
        policyOverride: { riskCeiling: "medium" },
      }),
      async () => ({ ok: true }),
    );
    expect(approved.ok).toBe(true);

    // 未设 riskCeiling → 不改变既有行为（只读低风险工具直通）。
    const lowTool: AgentTool = {
      definition: { ...baseDef, name: "plain_read_tool" },
      execute: async () => ({ ok: true }),
    };
    const pass = await approvalMiddleware(buildCall(workspaceDir, { tool: lowTool }), async () => ({
      ok: true,
    }));
    expect(pass.ok).toBe(true);
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

  it("timeoutMiddleware skips wall-clock kill when toolTimeoutMs is 0", async () => {
    const call = buildCall(workspaceDir, { policyOverride: { toolTimeoutMs: 0 } });
    const slow: ToolMiddleware = async () =>
      new Promise<ToolCallResult>((resolve) =>
        setTimeout(() => resolve({ ok: true, data: { slow: true } }), 80),
      );
    const result = await timeoutMiddleware(call, () => slow(call, async () => ({ ok: true })));
    expect(result.ok).toBe(true);
    expect(result.timedOut).toBeUndefined();
  });

  it("timeoutMiddleware returns timedOut when tool exceeds timeout", async () => {
    const call = buildCall(workspaceDir, { policyOverride: { toolTimeoutMs: 50 } });
    const slow: ToolMiddleware = async () =>
      new Promise<ToolCallResult>((resolve) => setTimeout(() => resolve({ ok: true }), 200));
    const result = await timeoutMiddleware(call, () => slow(call, async () => ({ ok: true })));
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBeUndefined();
    expect(result.error).toMatch(/timed out/);
  });

  it("timeoutMiddleware returns aborted when turn abortSignal fires before timeout", async () => {
    const turnAbort = new AbortController();
    const call = buildCall(workspaceDir, {
      policyOverride: { toolTimeoutMs: 5_000 },
      ctxOverride: { abortSignal: turnAbort.signal },
    });
    const hangingTool: ToolMiddleware = async () =>
      new Promise<ToolCallResult>(() => {
        /* relies on middleware race */
      });
    const pending = timeoutMiddleware(call, () => hangingTool(call, async () => ({ ok: true })));
    turnAbort.abort();
    const result = await pending;
    expect(result).toEqual({ ok: false, error: "已停止", aborted: true });
    expect(call.ctx.abortSignal).toBe(turnAbort.signal);
  });

  it("timeoutMiddleware scopes the timeout signal per call (shared ctx never polluted)", async () => {
    // 两个并发调用共享同一个 AgentContext：call-2 先注入 signal，call-1 后注入并超时。
    // 旧实现改写共享 ctx.abortSignal，call-1 的超时会把在途的 call-2 一起取消。
    const sharedCtx = buildAgentContext(workspaceDir);
    const call1: ToolCallContext = {
      ...buildCall(workspaceDir, { policyOverride: { toolTimeoutMs: 40 } }),
      ctx: sharedCtx,
    };
    const call2: ToolCallContext = {
      ...buildCall(workspaceDir, { policyOverride: { toolTimeoutMs: 5_000 } }),
      ctx: sharedCtx,
    };
    // call-2 的工具：慢但未超时（120ms < 5000ms）。像分阶段 fetch 的工具一样，
    // 第二阶段才再读 ctx.abortSignal——旧实现此时读到的是 call-1 注入的 signal。
    const slowCancelAware: ToolMiddleware = async (c) => {
      await new Promise((r) => setTimeout(r, 10));
      const sig = c.ctx.abortSignal;
      return new Promise<ToolCallResult>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true }), 120);
        sig?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("cancelled_by_signal"));
        });
      });
    };
    // call-1 的工具：挂起直到自己的超时 signal 翻转。
    const hanging: ToolMiddleware = async (c) =>
      new Promise<ToolCallResult>((_, reject) => {
        c.ctx.abortSignal?.addEventListener("abort", () => reject(new Error("aborted_by_timeout")));
      });
    const p2 = timeoutMiddleware(call2, () => slowCancelAware(call2, async () => ({ ok: true })));
    const p1 = timeoutMiddleware(call1, () => hanging(call1, async () => ({ ok: true })));
    const [r1, r2] = await Promise.all([p1, p2]);
    // 超时的只有 call-1；call-2 不受波及，正常完成。
    expect(r1.ok).toBe(false);
    expect(r1.timedOut).toBe(true);
    expect(r2).toEqual({ ok: true });
    // 共享 ctx 全程不被改写。
    expect(sharedCtx.abortSignal).toBeUndefined();
  });

  it("timeoutMiddleware aborts ctx.abortSignal on timeout so tools can cancel underlying work", async () => {
    const call = buildCall(workspaceDir, { policyOverride: { toolTimeoutMs: 40 } });
    let observedSignal: AbortSignal | undefined;
    let signalAbortedDuringTool = false;
    // A tool that records the injected signal and never resolves on its own — it should
    // observe the signal abort and reject, proving the pipeline cancels the underlying work.
    const hangingTool: ToolMiddleware = async (c) => {
      observedSignal = c.ctx.abortSignal;
      return new Promise<ToolCallResult>((_, reject) => {
        const sig = c.ctx.abortSignal;
        if (sig) {
          sig.addEventListener("abort", () => {
            signalAbortedDuringTool = sig.aborted;
            reject(new Error("aborted_by_timeout"));
          });
        }
      });
    };
    const result = await timeoutMiddleware(call, () =>
      hangingTool(call, async () => ({ ok: true })),
    );
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBeUndefined();
    // The signal was injected into ctx for this call...
    expect(observedSignal).toBeDefined();
    // ...and it flipped to aborted, which the tool observed (cancellation propagated).
    expect(signalAbortedDuringTool).toBe(true);
    expect(observedSignal!.aborted).toBe(true);
    // ctx.abortSignal is restored after the call (no leak across tool calls).
    expect(call.ctx.abortSignal).toBeUndefined();
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

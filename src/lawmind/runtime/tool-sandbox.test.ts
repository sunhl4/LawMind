import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallContext } from "./tool-pipeline.js";
import {
  assertSandboxRunnerOrRefuse,
  buildToolSandboxChildEnv,
  buildToolSandboxPayload,
  executeToolSandboxInline,
  resolveSandboxExecutionMode,
  SANDBOX_UNAVAILABLE,
} from "./tool-sandbox.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  dirs.length = 0;
});

function minimalCall(workspaceDir: string, toolName: string): ToolCallContext {
  return {
    toolCallId: "c1",
    toolName,
    args: { note: "x" },
    tool: undefined,
    ctx: {
      workspaceDir,
      sessionId: "s1",
      actorId: "a1",
      allowWebSearch: false,
      clarificationBlockingHeavyTools: false,
      collaborationEnabled: false,
    },
    turn: { turnId: "t1" },
    policy: {
      usedToolCalls: 0,
      maxToolCalls: 5,
      toolTimeoutMs: 5000,
      strictDangerousToolApproval: false,
      allowDangerousToolsWithoutApproval: false,
      actorId: "a1",
      auditDir: path.join(workspaceDir, "audit"),
      toolSandboxEnabled: true,
    },
  };
}

describe("tool-sandbox", () => {
  it("buildToolSandboxPayload copies policy and ctx fields", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sbx-"));
    dirs.push(ws);
    const payload = buildToolSandboxPayload(minimalCall(ws, "add_case_note"));
    expect(payload.toolName).toBe("add_case_note");
    expect(payload.workspaceDir).toBe(ws);
    expect(payload.sessionId).toBe("s1");
    expect(payload.timeoutMs).toBe(5000);
  });

  it("executeToolSandboxInline returns error for unknown tool", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sbx-"));
    dirs.push(ws);
    const result = await executeToolSandboxInline({
      toolName: "not_a_real_tool",
      args: {},
      workspaceDir: ws,
      sessionId: "s1",
      actorId: "a1",
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未知工具/);
  });

  it("refuses when the child runner is missing (no in-process fallback)", () => {
    const missing = path.join(os.tmpdir(), "lm-no-sandbox-runner", "missing-child.js");
    const refused = assertSandboxRunnerOrRefuse(missing);
    expect(refused?.ok).toBe(false);
    expect(refused?.error).toContain(SANDBOX_UNAVAILABLE);
    expect(refused?.sandboxed).toBe(false);
  });

  it("child mode is default outside tests and explicit inline", () => {
    expect(resolveSandboxExecutionMode({})).toBe("child");
    expect(resolveSandboxExecutionMode({ LAWMIND_TOOL_SANDBOX_INLINE: "1" })).toBe("inline");
    expect(resolveSandboxExecutionMode({ VITEST: "true" })).toBe("inline");
  });

  it("buildToolSandboxChildEnv 只带最小集，敏感变量不进子进程", () => {
    const env = buildToolSandboxChildEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      TMPDIR: "/tmp",
      LAWMIND_EDITION: "firm",
      LAWMIND_WORKSPACE_DIR: "/ws",
      LAWMIND_LOCAL_API_TOKEN: "loopback-secret",
      LAWMIND_SKIP_API_AUTH: "1",
      LAWMIND_AUTHORITY_API_KEY: "authority-secret",
      LAWMIND_MCP_FOO_SECRET: "mcp-secret",
      LAWMIND_AGENT_API_KEY: "agent-key",
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      QWEN_API_KEY: "sk-qwen",
      BRAVE_API_KEY: "brave-key",
      SOME_RANDOM_VAR: "x",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.TMPDIR).toBe("/tmp");
    // 非敏感 LAWMIND_* 配置保留（edition / 路径等影响工具行为）。
    expect(env.LAWMIND_EDITION).toBe("firm");
    expect(env.LAWMIND_WORKSPACE_DIR).toBe("/ws");
    // 敏感变量一律不得出现在子进程 env。
    expect(env.LAWMIND_LOCAL_API_TOKEN).toBeUndefined();
    expect(env.LAWMIND_SKIP_API_AUTH).toBeUndefined();
    expect(env.LAWMIND_AUTHORITY_API_KEY).toBeUndefined();
    expect(env.LAWMIND_MCP_FOO_SECRET).toBeUndefined();
    expect(env.LAWMIND_AGENT_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.QWEN_API_KEY).toBeUndefined();
    expect(env.BRAVE_API_KEY).toBeUndefined();
    expect(env.SOME_RANDOM_VAR).toBeUndefined();
  });
});

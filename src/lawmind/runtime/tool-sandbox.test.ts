import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallContext } from "./tool-pipeline.js";
import {
  assertSandboxRunnerOrRefuse,
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
});

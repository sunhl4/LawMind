/**
 * P2 POC: run high-risk tools in a child process when tool sandbox is enabled.
 */

import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLegalToolRegistry } from "../agent/tools/legal-tools.js";
import type { AgentContext, ToolCallResult } from "../agent/types.js";
import type { ToolCallContext } from "./tool-pipeline.js";

export type ToolSandboxPayload = {
  toolName: string;
  args: Record<string, unknown>;
  workspaceDir: string;
  sessionId: string;
  matterId?: string;
  actorId: string;
  assistantId?: string;
  allowWebSearch?: boolean;
  strictDangerousToolApproval?: boolean;
  permissionMode?: AgentContext["permissionMode"];
  envFile?: string;
  timeoutMs: number;
};

function buildAgentContextFromPayload(payload: ToolSandboxPayload): AgentContext {
  return {
    workspaceDir: payload.workspaceDir,
    sessionId: payload.sessionId,
    matterId: payload.matterId,
    actorId: payload.actorId,
    assistantId: payload.assistantId,
    allowWebSearch: payload.allowWebSearch === true,
    permissionMode: payload.permissionMode,
    envFile: payload.envFile,
    strictDangerousToolApproval: payload.strictDangerousToolApproval === true,
    clarificationBlockingHeavyTools: false,
    collaborationEnabled: false,
  };
}

export function buildToolSandboxPayload(call: ToolCallContext): ToolSandboxPayload {
  const { ctx, policy } = call;
  return {
    toolName: call.toolName,
    args: call.args,
    workspaceDir: ctx.workspaceDir,
    sessionId: ctx.sessionId,
    matterId: ctx.matterId ?? policy.sessionMatterId,
    actorId: policy.actorId,
    assistantId: ctx.assistantId ?? policy.sessionAssistantId,
    allowWebSearch: ctx.allowWebSearch,
    strictDangerousToolApproval: policy.strictDangerousToolApproval,
    permissionMode: ctx.permissionMode,
    envFile: ctx.envFile,
    timeoutMs: policy.toolTimeoutMs,
  };
}

/** In-process execution (tests and `LAWMIND_TOOL_SANDBOX_INLINE=1`). */
export async function executeToolSandboxInline(
  payload: ToolSandboxPayload,
): Promise<ToolCallResult> {
  const registry = createLegalToolRegistry({
    allowWebSearch: payload.allowWebSearch === true,
    enableCollaboration: false,
  });
  const tool = registry.get(payload.toolName);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${payload.toolName}` };
  }
  try {
    const ctx = buildAgentContextFromPayload(payload);
    return await tool.execute(payload.args, ctx);
  } catch (err) {
    return {
      ok: false,
      error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function childEntryPath(): string {
  return fileURLToPath(new URL("./tool-sandbox-child.js", import.meta.url));
}

function useInlineSandbox(): boolean {
  return (
    process.env.LAWMIND_TOOL_SANDBOX_INLINE?.trim() === "1" ||
    process.env.VITEST === "true" ||
    process.env.VITEST === "1"
  );
}

export async function runToolInSubprocessSandbox(call: ToolCallContext): Promise<ToolCallResult> {
  const payload = buildToolSandboxPayload(call);
  if (useInlineSandbox()) {
    const result = await executeToolSandboxInline(payload);
    return { ...result, sandboxed: true };
  }

  return new Promise<ToolCallResult>((resolve) => {
    let settled = false;
    let child: ChildProcess | undefined;
    const finish = (result: ToolCallResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        child?.kill();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `Tool ${payload.toolName} sandbox timed out after ${payload.timeoutMs}ms`,
        sandboxed: true,
      });
    }, payload.timeoutMs + 500);

    try {
      child = fork(childEntryPath(), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env },
      });
    } catch (err) {
      finish({
        ok: false,
        error: `Tool sandbox fork failed: ${err instanceof Error ? err.message : String(err)}`,
        sandboxed: true,
      });
      return;
    }

    child.on("message", (msg: unknown) => {
      if (!msg || typeof msg !== "object") {
        return;
      }
      const m = msg as { ok?: boolean; result?: ToolCallResult; error?: string };
      if (m.ok === true && m.result) {
        finish({ ...m.result, sandboxed: true });
        return;
      }
      finish({
        ok: false,
        error: m.error ?? "Tool sandbox child returned no result",
        sandboxed: true,
      });
    });

    child.on("error", (err) => {
      finish({
        ok: false,
        error: `Tool sandbox child error: ${err.message}`,
        sandboxed: true,
      });
    });

    child.on("exit", (code) => {
      if (!settled) {
        finish({
          ok: false,
          error: `Tool sandbox child exited (${code ?? "unknown"})`,
          sandboxed: true,
        });
      }
    });

    child.send(payload);
  });
}

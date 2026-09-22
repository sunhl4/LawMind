/**
 * P2 POC: run high-risk tools in a child process when tool sandbox is enabled.
 * Missing runner refuses — never silently fall back to in-process.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createLegalToolRegistry } from "../agent/tools/legal-tools.js";
import type { AgentContext, ToolCallResult } from "../agent/types.js";
import { buildSandboxChildEnv, safeCommand } from "../platform/safe-command.js";
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
    return { ok: false, error: `未知工具：${payload.toolName}。该工具未注册，请核对请求。` };
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

/**
 * 沙箱子进程 env 白名单。
 * 复用统一命令网关的 buildSandboxChildEnv，过滤掉本地 API token、鉴权旁路开关
 * 与模型/集成密钥，但保留非敏感的 LAWMIND_* 配置项。
 */
export function buildToolSandboxChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return buildSandboxChildEnv(source);
}

export const SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE";

export function sandboxUnavailableResult(reason: string): ToolCallResult {
  return {
    ok: false,
    error: `${SANDBOX_UNAVAILABLE}: ${reason}`,
    sandboxed: false,
  };
}

export function childEntryPath(): string {
  return fileURLToPath(new URL("./tool-sandbox-child.js", import.meta.url));
}

export function resolveSandboxExecutionMode(
  env: NodeJS.ProcessEnv = process.env,
): "inline" | "child" {
  if (env.LAWMIND_TOOL_SANDBOX_INLINE?.trim() === "1") {
    return "inline";
  }
  if (env.VITEST === "true" || env.VITEST === "1") {
    return "inline";
  }
  return "child";
}

export function assertSandboxRunnerOrRefuse(runnerPath: string): ToolCallResult | undefined {
  if (fs.existsSync(runnerPath)) {
    return undefined;
  }
  return sandboxUnavailableResult(`runner missing (${runnerPath}). Refusing in-process fallback.`);
}

export async function runToolInSubprocessSandbox(call: ToolCallContext): Promise<ToolCallResult> {
  const payload = buildToolSandboxPayload(call);
  if (resolveSandboxExecutionMode() === "inline") {
    const result = await executeToolSandboxInline(payload);
    return { ...result, sandboxed: true };
  }
  const refuse = assertSandboxRunnerOrRefuse(childEntryPath());
  if (refuse) {
    return refuse;
  }

  return new Promise<ToolCallResult>((resolve) => {
    let settled = false;
    let handle!: ReturnType<typeof safeCommand>;
    const finish = (result: ToolCallResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        handle?.kill();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    try {
      handle = safeCommand({
        command: childEntryPath(),
        args: [],
        ipc: true,
        execArgv: ["--import", "tsx"],
        env: buildToolSandboxChildEnv(),
        timeoutMs: payload.timeoutMs + 500,
      });
    } catch (err) {
      finish(
        sandboxUnavailableResult(
          `fork failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    handle.child.on("message", (msg: unknown) => {
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

    handle.child.on("error", (err) => {
      finish({
        ok: false,
        error: `Tool sandbox child error: ${err.message}`,
        sandboxed: true,
      });
    });

    handle.finished
      .then((res) => {
        if (!settled) {
          finish({
            ok: false,
            error: `Tool sandbox child exited (${res.exitCode ?? res.exitSignal ?? "unknown"})${res.stderr ? `: ${res.stderr.slice(0, 200)}` : ""}`,
            sandboxed: true,
          });
        }
      })
      .catch((err) => {
        finish({
          ok: false,
          error: `Tool sandbox child error: ${err instanceof Error ? err.message : String(err)}`,
          sandboxed: true,
        });
      });

    handle.child.send(payload);
  });
}

/**
 * Shared guest execution for run_analysis (file) and run_compute (inline).
 *
 * 子进程路径复用 `safeCommand`（ipc fork）：绝对路径、超时、最小 env。
 * 不另造「沙箱审计产品面」——可审计不是卖点；需要调查时走既有 safe_command 通道即可。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalChildEnv, safeCommand } from "../../../platform/safe-command.js";
import type { ToolCallResult } from "../../types.js";
import { ANALYSIS_TIMEOUT_MS, runAnalysisScriptInVm } from "./analysis-sandbox.js";

function childEntryPath(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const names = [
    "analysis-sandbox-child.ts",
    "analysis-sandbox-child.js",
    "analysis-sandbox-child.cjs",
  ];
  for (const name of names) {
    const abs = path.join(here, name);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }
  return undefined;
}

function shouldRunInline(): boolean {
  return process.env.VITEST === "true" || process.env.VITEST === "1";
}

export async function runSandboxedAnalysisSource(
  source: string,
  workspaceDir: string,
): Promise<ToolCallResult> {
  if (shouldRunInline()) {
    const result = await runAnalysisScriptInVm({
      source,
      workspaceDir,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
    });
    return { ok: true, data: result, sandboxed: true };
  }
  return runInChild(source, workspaceDir);
}

async function runInChild(source: string, workspaceDir: string): Promise<ToolCallResult> {
  const entry = childEntryPath();
  if (!entry) {
    // 缺子进程入口时退回同进程 VM：保持交件可用（铁律 2/3），不硬拒。
    const result = await runAnalysisScriptInVm({
      source,
      workspaceDir,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
    });
    return { ok: true, data: result, sandboxed: true };
  }

  return new Promise((resolve) => {
    let settled = false;
    let handle!: ReturnType<typeof safeCommand>;
    const finish = (result: ToolCallResult) => {
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
        command: entry,
        args: [],
        ipc: true,
        execArgv: entry.endsWith(".ts") ? ["--import", "tsx"] : [],
        env: buildMinimalChildEnv(),
        timeoutMs: ANALYSIS_TIMEOUT_MS + 500,
        // 不传 auditDir：分析脚本起停不是律师面卖点；调查时可在上层接线。
      });
    } catch (err) {
      finish({
        ok: false,
        error: `无法启动分析沙箱：${err instanceof Error ? err.message : String(err)}`,
        sandboxed: false,
      });
      return;
    }

    handle.child.on("message", (msg: unknown) => {
      const m = msg as { ok?: boolean; result?: unknown; error?: string };
      if (m.ok === true) {
        finish({ ok: true, data: m.result, sandboxed: true });
        return;
      }
      finish({ ok: false, error: m.error ?? "分析沙箱失败", sandboxed: true });
    });

    handle.child.on("error", (err) => {
      finish({ ok: false, error: err.message, sandboxed: true });
    });

    handle.finished
      .then((res) => {
        if (!settled) {
          finish({
            ok: false,
            error:
              res.exitSignal === "SIGTERM" || res.exitSignal === "SIGKILL"
                ? "分析脚本超时（15 秒）。"
                : `分析沙箱退出（${res.exitCode ?? res.exitSignal ?? "unknown"}）`,
            sandboxed: true,
            ...(res.exitSignal === "SIGTERM" || res.exitSignal === "SIGKILL"
              ? { timedOut: true }
              : {}),
          });
        }
      })
      .catch((err) => {
        finish({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          sandboxed: true,
        });
      });

    handle.child.send({ source, workspaceDir, timeoutMs: ANALYSIS_TIMEOUT_MS });
  });
}

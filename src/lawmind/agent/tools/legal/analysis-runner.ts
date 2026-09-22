/**
 * Shared guest execution for run_analysis (file) and run_compute (inline).
 */

import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    const result = await runAnalysisScriptInVm({
      source,
      workspaceDir,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
    });
    return { ok: true, data: result, sandboxed: true };
  }
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess | undefined;
    const finish = (result: ToolCallResult) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child?.kill();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: "分析脚本超时（15 秒）。", sandboxed: true, timedOut: true });
    }, ANALYSIS_TIMEOUT_MS + 500);
    try {
      const execArgv = entry.endsWith(".ts") ? ["--import", "tsx"] : [];
      child = fork(entry, [], {
        execArgv,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      finish({
        ok: false,
        error: `无法启动分析沙箱：${err instanceof Error ? err.message : String(err)}`,
        sandboxed: false,
      });
      return;
    }
    child.on("message", (msg: unknown) => {
      clearTimeout(timer);
      const m = msg as { ok?: boolean; result?: unknown; error?: string };
      if (m.ok === true) {
        finish({ ok: true, data: m.result, sandboxed: true });
        return;
      }
      finish({ ok: false, error: m.error ?? "分析沙箱失败", sandboxed: true });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: err.message, sandboxed: true });
    });
    child.on("exit", (code) => {
      if (!settled) {
        clearTimeout(timer);
        finish({ ok: false, error: `分析沙箱退出（${code ?? "unknown"}）`, sandboxed: true });
      }
    });
    child.send({ source, workspaceDir, timeoutMs: ANALYSIS_TIMEOUT_MS });
  });
}

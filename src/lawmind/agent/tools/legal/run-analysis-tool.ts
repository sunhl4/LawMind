import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emit } from "../../../audit/index.js";
import { isAnalysisScriptsAllowed } from "../../../policy/analysis-scripts.js";
import {
  isAllowedAnalysisScriptRel,
  parseSkillAnalysisScriptRel,
} from "../../../runtime/analysis-script-path.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import { listLocalSkills } from "../../../skills/skill-runtime.js";
import type { AgentTool, ToolCallResult } from "../../types.js";
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

function skillScriptAllowed(workspaceDir: string, rel: string): boolean {
  const parsed = parseSkillAnalysisScriptRel(rel);
  if (!parsed) {
    return true;
  }
  try {
    return listLocalSkills(workspaceDir).some(
      (s) =>
        s.enabled &&
        s.signatureOk &&
        (s.id === parsed.skillId || path.basename(s.dir) === parsed.skillId),
    );
  } catch {
    return false;
  }
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

export const runAnalysis: AgentTool = {
  definition: {
    name: "run_analysis",
    description:
      "在受控沙箱中运行律师确认的分析脚本。只暴露 readTable / stats / writeTable / emitChart。默认关闭，须工作区政策 allowAnalysisScripts。",
    category: "analyze",
    parameters: {
      path: {
        type: "string",
        description: "lawmind/skills/<id>/scripts/*.js 或 artifacts/analysis-scripts/*.js",
        required: true,
      },
      confirmed: {
        type: "boolean",
        description: "artifacts 下脚本必须为 true（律师已确认）",
      },
    },
    requiresApproval: true,
    riskLevel: "high",
  },
  async execute(params, ctx) {
    if (!isAnalysisScriptsAllowed(ctx.workspaceDir)) {
      return {
        ok: false,
        error: "工作区未开启分析脚本（设置 · 安全与工具）。高安全模式下不可用。",
      };
    }
    const claimed = typeof params.path === "string" ? params.path.trim() : "";
    const resolved = resolveWorkspaceRelativePath(ctx.workspaceDir, claimed);
    if (!resolved.ok) {
      return { ok: false, error: "脚本路径必须在工作区内。" };
    }
    if (!isAllowedAnalysisScriptRel(resolved.rel)) {
      return {
        ok: false,
        error: "脚本只能放在 lawmind/skills/<id>/scripts/*.js 或 artifacts/analysis-scripts/*.js。",
      };
    }
    if (!skillScriptAllowed(ctx.workspaceDir, resolved.rel)) {
      return { ok: false, error: "只能运行已启用且签名通过的技能脚本。" };
    }
    if (resolved.rel.startsWith("artifacts/analysis-scripts/") && params.confirmed !== true) {
      return { ok: false, error: "artifacts 下的脚本须律师确认（confirmed=true）。" };
    }
    if (!fs.existsSync(resolved.abs) || !fs.statSync(resolved.abs).isFile()) {
      return { ok: false, error: `找不到脚本：${resolved.rel}` };
    }
    const source = fs.readFileSync(resolved.abs, "utf8");
    const auditDir = path.join(ctx.workspaceDir, "audit");
    try {
      const result = shouldRunInline()
        ? {
            ok: true as const,
            data: await runAnalysisScriptInVm({
              source,
              workspaceDir: ctx.workspaceDir,
              timeoutMs: ANALYSIS_TIMEOUT_MS,
            }),
            sandboxed: true,
          }
        : await runInChild(source, ctx.workspaceDir);
      await emit(auditDir, {
        taskId: ctx.sessionId,
        kind: "tool_call",
        actor: "model",
        actorId: ctx.actorId,
        detail: `run_analysis ${resolved.rel} ${result.ok ? "ok" : "fail"}`,
      }).catch(() => undefined);
      return result;
    } catch (err) {
      await emit(auditDir, {
        taskId: ctx.sessionId,
        kind: "tool_call",
        actor: "model",
        actorId: ctx.actorId,
        detail: `run_analysis ${resolved.rel} fail`,
      }).catch(() => undefined);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        sandboxed: true,
      };
    }
  },
};

import fs from "node:fs";
import path from "node:path";
import { emit } from "../../../audit/index.js";
import { isAnalysisScriptsAllowed } from "../../../policy/analysis-scripts.js";
import {
  isAllowedAnalysisScriptRel,
  parseSkillAnalysisScriptRel,
} from "../../../runtime/analysis-script-path.js";
import { fenceAgentFilePath } from "../../../runtime/workspace-io-fence.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import type { AgentTool } from "../../types.js";
import { runSandboxedAnalysisSource } from "./analysis-runner.js";

/** Workspace skill folders are not an install surface. Only lawyer-confirmed artifact scripts run. */
function skillScriptAllowed(_workspaceDir: string, rel: string): boolean {
  return parseSkillAnalysisScriptRel(rel) == null;
}

export const runAnalysis: AgentTool = {
  definition: {
    name: "run_analysis",
    description:
      "运行已确认的分析脚本（artifacts/analysis-scripts/*.js）。只暴露文件/表格/出图接口，不暴露 fs 与网络。默认可用；离线模式或策略明确关闭时不可用。工作区技能目录里的脚本不执行。日常核算请用 run_compute。",
    category: "analyze",
    parameters: {
      path: {
        type: "string",
        description: "artifacts/analysis-scripts/*.js（须 confirmed=true）",
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
        error: "当前不运行分析脚本。日常核算请用 run_compute。",
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
      return {
        ok: false,
        error:
          "作业标准随软件内置，不从工作区技能目录运行脚本。请把脚本放在 artifacts/analysis-scripts/ 并经律师确认。",
      };
    }
    if (resolved.rel.startsWith("artifacts/analysis-scripts/") && params.confirmed !== true) {
      return { ok: false, error: "artifacts 下的脚本须律师确认（confirmed=true）。" };
    }
    const fenced = fenceAgentFilePath({ rootDir: ctx.workspaceDir, abs: resolved.abs });
    if (!fenced.ok) {
      return { ok: false, error: fenced.error };
    }
    if (!fs.existsSync(fenced.abs) || !fs.statSync(fenced.abs).isFile()) {
      return { ok: false, error: `找不到脚本：${resolved.rel}` };
    }
    const source = fs.readFileSync(fenced.abs, "utf8");
    const auditDir = path.join(ctx.workspaceDir, "audit");
    try {
      const result = await runSandboxedAnalysisSource(source, ctx.workspaceDir);
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

import fs from "node:fs";
import path from "node:path";
import { emit } from "../../../audit/index.js";
import { isAnalysisScriptsAllowed } from "../../../policy/analysis-scripts.js";
import {
  isAllowedAnalysisScriptRel,
  parseSkillAnalysisScriptRel,
} from "../../../runtime/analysis-script-path.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import { listLocalSkills } from "../../../skills/skill-runtime.js";
import type { AgentTool } from "../../types.js";
import { runSandboxedAnalysisSource } from "./analysis-runner.js";

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

export const runAnalysis: AgentTool = {
  definition: {
    name: "run_analysis",
    description:
      "运行律师已确认或已签名技能里的分析脚本。只暴露表格/出图接口。默认关闭，须工作区政策 allowAnalysisScripts。日常核算请用 run_compute（模型当场写 JS，不必先落文件）。",
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
        error: "工作区未开启分析脚本（设置 · 安全）。日常核算请用 run_compute。",
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

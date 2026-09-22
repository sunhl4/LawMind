/**
 * 一般文件操作（`apply_file_ops`）：工作区内的搬移、改名、复制。
 *
 * 这是 LawMind 给模型的**通用"手"**。在此之前，模型能在工作区里**新建/覆盖**文件
 * （`write_document`），却改不了已有文件的位置和名字——于是「把这个材料改名」「复制
 * 一份来对照」「按日期整理到子目录」这类律师天天要做的事全都办不了；唯一的移动能力
 * 被锁在 `materials/` 之内（organize plan）。文件名就是律师的归档系统，缺这只手
 * 等于缺一半的整理能力。
 *
 * 安全立场（为什么这只手可以默认给，而 `run_host_command` 默认关）：
 *
 *   1. **不产生新内容**。它只移动/复制既有文件，不写新字节——危险性严格低于已经存在的
 *      `write_document`（后者能在工作区任意位置写任意内容）。
 *   2. **可撤销**。每次执行写 desk-write 日志（`file_ops`），`revert_desk_write` 按工作区根
 *      反向回放；复制件在被律师改过时不静默删除。
 *   3. **不出工作区**。`fenceAgentFilePath` + 工作区相对路径，越界即拒。
 *   4. **不碰真相源**。治理目录（lawmind/ audit/ sessions/ tasks/ matters/）、`.env`、
 *      `RULES.md` 等一律拒；审核台的 `drafts/` 与交付物 `artifacts/` 也拒——它们的路径
 *      被任务记录引用，原始改名会让在办/审核台对不上号，那是产品功能不是文件操作。
 *
 * **不做删除**。删除不可逆且没有任何"撤销"能兜住（回收站语义要产品级设计），所以
 * 删除仍然是律师在文件页的动作。这条线是刻意的，不是遗漏。
 *
 * 与 `relocate_matter_materials` 的分工：那支是**案件归档语义**（只认 cases/uploads，
 * 带当事人对立提示，进案件办理工具包）；这支是**通用文件语义**（整个工作区）。
 */

import { isProtectedAnalysisScriptRel } from "../../../runtime/analysis-script-path.js";
import {
  PROTECTED_WORKSPACE_WRITE_REFUSAL,
  isProtectedWorkspaceRel,
} from "../../../runtime/protected-workspace-rels.js";
import { fenceAgentFilePath } from "../../../runtime/workspace-io-fence.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import type { AgentTool } from "../../types.js";
import { matterRequiredResult } from "../matter-required.js";
import {
  FILE_OPS_MAX_OPS,
  applySolvedFileOps,
  crossedMatterIds,
  formatAppliedLines,
  isCaseStructuralRel,
  missingTargetMatters,
  solveFileOps,
  type ClassifyResult,
} from "./workspace-file-ops.js";

/** 引擎自己管理的树：路径被任务/草稿记录引用，原始改名会打断引用关系。 */
const ENGINE_MANAGED_PREFIXES = ["drafts/", "artifacts/"];

function isEngineManagedRel(rel: string): boolean {
  return ENGINE_MANAGED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/**
 * 通用文件操作的围栏：整个工作区，但排除真相源与被任务引用的引擎树。
 */
function classifyWorkspacePath(workspaceDir: string, raw: string): ClassifyResult {
  const resolved = resolveWorkspaceRelativePath(workspaceDir, raw);
  if (!resolved.ok) {
    return {
      ok: false,
      error:
        resolved.error === "empty"
          ? "路径为空。"
          : "不允许在工作区之外操作文件（请用工作区相对路径）。",
    };
  }
  const rel = resolved.rel;
  if (!rel) {
    return { ok: false, error: "不能操作工作区根目录本身。请指明具体文件或文件夹。" };
  }
  if (isProtectedWorkspaceRel(rel)) {
    return { ok: false, error: PROTECTED_WORKSPACE_WRITE_REFUSAL };
  }
  if (isProtectedAnalysisScriptRel(rel)) {
    return {
      ok: false,
      error: "分析脚本目录只能由已签名技能或律师确认后写入，不能用文件操作搬移。",
    };
  }
  if (isEngineManagedRel(rel)) {
    return {
      ok: false,
      error:
        "drafts/ 与 artifacts/ 是引擎登记草稿与交付物的位置，路径被任务记录引用；请用工作台的导出/另存功能，不要直接搬移。",
    };
  }
  if (isCaseStructuralRel(rel)) {
    return {
      ok: false,
      error: `「${rel.split("/").slice(2).join("/")}」是案件的真相源文件（卷宗/期限/谈话/写入日志），不能搬移；改档案请用 update_matter_profile / apply_legal_events 等工具。`,
    };
  }
  const fenced = fenceAgentFilePath({ rootDir: workspaceDir, abs: resolved.abs });
  if (!fenced.ok) {
    return { ok: false, error: fenced.error };
  }
  return {
    ok: true,
    scoped: {
      abs: fenced.abs,
      rel,
      matterId: rel.startsWith("cases/") ? (rel.split("/")[1] ?? null) : null,
      label: rel.startsWith("cases/") ? `案件 ${rel.split("/")[1] ?? ""}` : "工作区",
    },
  };
}

export const applyFileOps: AgentTool = {
  definition: {
    name: "apply_file_ops",
    description:
      "在工作区里搬移、改名、复制文件或文件夹（不改内容，不删除）。" +
      "改名＝from 与 to 同目录不同名；复制＝copy=true（源文件保留）。" +
      "目标不存在时按需创建父目录。每次执行可用 revert_desk_write 撤销。" +
      "工作区外的本机文件请用 import_host_file；跨案件归位材料可用 relocate_matter_materials。" +
      "治理目录、drafts/、artifacts/、.env、RULES.md 等不可操作。",
    category: "matter",
    parameters: {
      ops: {
        type: "array",
        description: "逐条操作：from/to 为工作区相对路径；copy=true 表示复制而非移动。",
        required: true,
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            copy: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
      matter_id: {
        type: "string",
        description: "撤销日志归属的案件 ID（默认当前会话案件）",
      },
      goal: { type: "string", description: "给律师看的一句话目的，例如「把扫描件按日期改名」" },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const matterId =
      (typeof params.matter_id === "string" ? params.matter_id.trim() : "") || ctx.matterId || "";
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const rawOps = Array.isArray(params.ops) ? params.ops : [];
    if (rawOps.length === 0) {
      return {
        ok: false,
        error:
          "没有要执行的操作。请先用 list_dir / explore_folder 看清现状，再给出逐条 from → to。",
      };
    }
    if (rawOps.length > FILE_OPS_MAX_OPS) {
      return {
        ok: false,
        error: `一次最多执行 ${FILE_OPS_MAX_OPS} 条（本次 ${rawOps.length} 条）。请分批。`,
      };
    }
    const { solved, skipped } = solveFileOps({
      workspaceDir: ctx.workspaceDir,
      rawOps,
      classify: classifyWorkspacePath,
    });
    if (solved.length === 0) {
      return {
        ok: false,
        error: `没有可执行的操作。${skipped.join("；")}`,
        data: { skipped },
      };
    }
    const missing = missingTargetMatters(ctx.workspaceDir, solved);
    if (missing.length > 0) {
      return {
        ok: false,
        error: `目标案件「${missing.join("、")}」不存在。请先新建该案，或改用已存在的案件 ID。`,
      };
    }
    const { applied, failed, writeId } = applySolvedFileOps({
      workspaceDir: ctx.workspaceDir,
      matterId,
      solved,
    });
    if (applied.length === 0) {
      return { ok: false, error: `未执行任何操作：${failed.join("；")}` };
    }
    const copied = applied.filter((op) => op.copied === true).length;
    const moved = applied.length - copied;
    const goal =
      typeof params.goal === "string" && params.goal.trim()
        ? params.goal.replace(/\s+/g, " ").trim().slice(0, 80)
        : "";
    // 跨案搬移时把涉及到的其它案件编号一并回报，便于律师核对上下文。
    const crossed = crossedMatterIds(applied, matterId);
    return {
      ok: true,
      data: {
        writeId,
        matterId,
        appliedCount: applied.length,
        movedCount: moved,
        copiedCount: copied,
        applied: formatAppliedLines(applied),
        ...(crossed.length > 0 ? { crossedMatterIds: crossed } : {}),
        ...(skipped.length > 0 ? { skipped } : {}),
        ...(failed.length > 0 ? { failed } : {}),
        planText: formatAppliedLines(applied).join("\n"),
        goal: goal || undefined,
        message:
          `已完成 ${applied.length} 项（移动 ${moved}、复制 ${copied}）。` +
          `撤销：revert_desk_write（writeId=${writeId}，matter_id=${matterId}）。`,
      },
    };
  },
};

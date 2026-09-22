/**
 * 归位材料（`relocate_matter_materials`）：把放错案的材料挪回/复制到正确的卷。
 *
 * 为什么单独有这支笔：`propose_organize_plan` / `execute_organize_plan` 的围栏是
 * **单案 `materials/` 之内**（见 organize-materials-tool.ts），所以「这份材料其实
 * 属于另一案」在对话里无解——助手只能说「我没有移动权限」，律师被迫自己去文件页
 * 手拖。这正是真实事故里律师反复「调整了好几次都没办法」的那一半。
 *
 * 口径（与「对话补档案」一致）：**律师在对话里点要办的事就是授权**，所以本工具
 * 直接执行、不弹确认；但要满足四条硬约束，缺一不可：
 *
 *   1. 围栏：路径必须落在 `cases/<案>/…` 或 `uploads/…`，不得越出工作区。
 *   2. 真相源保护：CASE.md / matter.json / deadlines.jsonl / intake-brief.json /
 *      desk-writes.jsonl / organize-plan.pending.json 等结构文件不可搬（用搬移
 *      冒充改案是治理漏洞），另有 isProtectedWorkspaceRel 兜底治理目录。
 *   3. 符号链接不跟：materials 里出现软链一律拒办，避免借链出工作区。
 *   4. 可撤销：每次执行写 desk-write 日志（`file_ops`），revert_desk_write 按工作区根
 *      反向回放；复制件在被律师改过时不静默删除。
 *
 * 跨案搬移不设「当事人对立就拒绝」的硬门：材料本来就已经放错了，拒绝只会让错误
 * 留在原处；对立只作为提示回给律师（提示核对利益冲突），由律师定夺。
 *
 * 执行/记账的公共动作在 `workspace-file-ops.ts`；本文件只负责**围栏**与**提示**。
 */

import { partiesConflict, readMatterParties } from "../../../host-access/matter-fence.js";
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

/**
 * 归位的围栏：只认 `cases/<案>/…` 与 `uploads/…` 两个根。
 */
function classifyMaterialPath(workspaceDir: string, raw: string): ClassifyResult {
  const resolved = resolveWorkspaceRelativePath(workspaceDir, raw);
  if (!resolved.ok) {
    return {
      ok: false,
      error:
        resolved.error === "empty"
          ? "路径为空。"
          : "不允许在工作区之外搬移材料（请用工作区相对路径）。",
    };
  }
  const rel = resolved.rel;
  if (!rel) {
    return { ok: false, error: "不能搬移工作区根目录。" };
  }
  if (isProtectedWorkspaceRel(rel)) {
    return { ok: false, error: PROTECTED_WORKSPACE_WRITE_REFUSAL };
  }
  const fenced = fenceAgentFilePath({ rootDir: workspaceDir, abs: resolved.abs });
  if (!fenced.ok) {
    return { ok: false, error: fenced.error };
  }
  const segments = rel.split("/");
  if (segments[0] === "uploads") {
    if (segments.length < 2) {
      return { ok: false, error: "不能搬移收件区目录本身。" };
    }
    return { ok: true, scoped: { abs: fenced.abs, rel, matterId: null, label: "收件区" } };
  }
  if (segments[0] !== "cases") {
    return {
      ok: false,
      error: "只能搬移案件卷内或收件区（uploads/）的材料；工作区其它位置不属于案件材料。",
    };
  }
  if (segments.length < 3) {
    return { ok: false, error: "不能搬移整个案件目录。请指明卷内的具体文件或文件夹。" };
  }
  const matterId = segments[1] ?? "";
  if (!matterId || matterId === "." || matterId.includes("..")) {
    return { ok: false, error: "案件 ID 不合法。" };
  }
  if (isCaseStructuralRel(rel)) {
    return {
      ok: false,
      error: `「${segments[2] ?? ""}」是本案的真相源文件，不能搬移。只能搬卷内的材料文件。`,
    };
  }
  return { ok: true, scoped: { abs: fenced.abs, rel, matterId, label: `案件 ${matterId}` } };
}

export const relocateMatterMaterials: AgentTool = {
  definition: {
    name: "relocate_matter_materials",
    description:
      "把材料在工作区里搬移/复制到正确的案件卷（跨案件可用）：修「材料放错案」、把收件区 uploads/ 的材料归档进本案、把误收进本案的材料退回原案。" +
      "路径用工作区相对路径（如 cases/甲案/materials/某文件夹 → cases/乙案/materials/）。" +
      "move 默认移动，copy=true 为复制。不改文件内容，不删文件；每次执行可用 revert_desk_write 撤销。" +
      "案件真相源文件（CASE.md、deadlines.jsonl 等）不可搬移。",
    category: "matter",
    parameters: {
      ops: {
        type: "array",
        description:
          "逐条搬移：from/to 为工作区相对路径（须在 cases/<案>/ 或 uploads/ 下）；copy=true 表示复制。",
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
        description: "目标案件 ID（默认当前会话案件；用于写撤销日志）",
      },
      goal: { type: "string", description: "给律师看的一句话目的，例如「把放错的材料挪回岚江案」" },
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
          "没有要搬移的条目。请先用 list_dir / explore_folder 看清材料位置，再给出逐条 from → to。",
      };
    }
    if (rawOps.length > FILE_OPS_MAX_OPS) {
      return {
        ok: false,
        error: `一次最多搬移 ${FILE_OPS_MAX_OPS} 条（本次 ${rawOps.length} 条）。请分批。`,
      };
    }
    const { solved, skipped } = solveFileOps({
      workspaceDir: ctx.workspaceDir,
      rawOps,
      classify: classifyMaterialPath,
    });
    if (solved.length === 0) {
      return {
        ok: false,
        error: `没有可执行的搬移。${skipped.join("；")}`,
        data: { skipped },
      };
    }
    const missing = missingTargetMatters(ctx.workspaceDir, solved);
    if (missing.length > 0) {
      return {
        ok: false,
        error: `目标案件「${missing.join("、")}」不存在。请先在对话里新建该案，或改用已存在的案件 ID。`,
      };
    }
    const { applied, failed, writeId } = applySolvedFileOps({
      workspaceDir: ctx.workspaceDir,
      matterId,
      solved,
    });
    if (applied.length === 0) {
      return { ok: false, error: `搬移未执行：${failed.join("；")}` };
    }
    // 跨案搬移不设当事人对立的硬门（材料已经放错了，拒绝只会把错误留在原处），
    // 但对立必须让律师看见：提示核对利益冲突，由律师定夺。
    const advisories: string[] = [];
    for (const other of crossedMatterIds(applied, matterId)) {
      try {
        if (
          partiesConflict(
            readMatterParties(ctx.workspaceDir, matterId),
            readMatterParties(ctx.workspaceDir, other),
          )
        ) {
          advisories.push(
            `本案与「${other}」的当事人存在对立关系。材料已按您的指示搬移；如需隔离，请核对利益冲突后再使用。`,
          );
        }
      } catch {
        /* advisory only */
      }
    }
    const goal =
      typeof params.goal === "string" && params.goal.trim()
        ? params.goal.replace(/\s+/g, " ").trim().slice(0, 80)
        : "";
    return {
      ok: true,
      data: {
        writeId,
        matterId,
        appliedCount: applied.length,
        applied: applied.map((op) => `${op.from} → ${op.to}`),
        ...(skipped.length > 0 ? { skipped } : {}),
        ...(failed.length > 0 ? { failed } : {}),
        ...(advisories.length > 0 ? { advisories } : {}),
        planText: formatAppliedLines(applied).join("\n"),
        goal: goal || undefined,
        message:
          `已搬移 ${applied.length} 项。` +
          `撤销：revert_desk_write（writeId=${writeId}，matter_id=${matterId}）。`,
      },
    };
  },
};

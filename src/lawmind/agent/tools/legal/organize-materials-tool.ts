/**
 * 整理案卷三件套（对标 Harvey Agentic Vault Organization）：
 *   propose_organize_plan  — 只读现状 + 记录待确认计划（不写盘移动任何文件）
 *   execute_organize_plan  — 律师确认后逐条执行，写 desk-write 日志（可撤销）
 *   revert_desk_write      — 反向回放（desk-apply.ts 的 organize_files 分支）
 *
 * 围栏：所有路径必须在本案 materials/ 内；计划只覆盖移动/重命名，不改文件内容。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  appendDeskWrite,
  newDeskWriteId,
  type OrganizeFileOp,
} from "../../../desk/desk-write-journal.js";
import { listMatterMaterialFiles } from "../../../desk/matter-materials.js";
import type { AgentTool } from "../../types.js";
import { matterRequiredResult } from "../matter-required.js";

type PendingOrganizePlan = {
  planId: string;
  matterId: string;
  goal?: string;
  ops: OrganizeFileOp[];
  createdAt: string;
  status: "pending" | "executed";
  writeId?: string;
};

function pendingPlanPath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "organize-plan.pending.json");
}

function readPendingPlan(workspaceDir: string, matterId: string): PendingOrganizePlan | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(pendingPlanPath(workspaceDir, matterId), "utf8"),
    ) as PendingOrganizePlan;
    return raw.status === "pending" && Array.isArray(raw.ops) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function writePendingPlan(workspaceDir: string, plan: PendingOrganizePlan): void {
  const p = pendingPlanPath(workspaceDir, plan.matterId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

function materialsRoot(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "materials");
}

/** Normalize + fence a materials-relative path. Returns null when out of fence. */
function fenceRel(root: string, rel: string): string | null {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!cleaned || cleaned.includes("..")) {
    return null;
  }
  const abs = path.resolve(root, cleaned);
  if (!abs.startsWith(path.resolve(root) + path.sep) && abs !== path.resolve(root)) {
    return null;
  }
  return cleaned;
}

function formatPlanLines(ops: OrganizeFileOp[]): string {
  return ops
    .map((op, i) => `${i + 1}. ${op.from} → ${op.to}${op.reason ? `（${op.reason}）` : ""}`)
    .join("\n");
}

export const proposeOrganizePlan: AgentTool = {
  definition: {
    name: "propose_organize_plan",
    description:
      "为本案 materials 文件夹起草整理计划（移动/重命名），先给律师逐条确认，不实际改动任何文件。" +
      "律师确认后再调用 execute_organize_plan 执行；执行可用 revert_desk_write 撤销。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
      goal: {
        type: "string",
        description: "整理目标（如「按对方当事人归类」「按文件类型分文件夹」）",
      },
      ops: {
        type: "array",
        description: "计划操作：from/to 均为本案 materials 内的相对路径",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            reason: { type: "string" },
          },
          required: ["from", "to"],
        },
        required: true,
      },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string)?.trim() || ctx.matterId;
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const rawOps = Array.isArray(params.ops) ? params.ops : [];
    if (rawOps.length === 0) {
      return {
        ok: false,
        error:
          "整理计划为空。先用 list_dir / read_folder_documents 看清材料，再给出逐条移动/重命名。",
      };
    }
    const root = materialsRoot(ctx.workspaceDir, matterId);
    const existing = new Set(
      listMatterMaterialFiles(ctx.workspaceDir, matterId, { maxFiles: 500 }).map((m) => m.fileName),
    );
    const ops: OrganizeFileOp[] = [];
    const problems: string[] = [];
    const seenTargets = new Set<string>();
    for (const raw of rawOps) {
      const row = raw as { from?: unknown; to?: unknown; reason?: unknown };
      const from = typeof row.from === "string" ? fenceRel(root, row.from) : null;
      const to = typeof row.to === "string" ? fenceRel(root, row.to) : null;
      if (!from || !to) {
        problems.push(`${String(row.from)} → ${String(row.to)}：路径越出本案 materials`);
        continue;
      }
      if (from === to) {
        continue;
      }
      if (!fs.existsSync(path.join(root, from))) {
        problems.push(`${from}：材料里不存在`);
        continue;
      }
      if (seenTargets.has(to) || fs.existsSync(path.join(root, to))) {
        problems.push(`${to}：目标已存在或计划内冲突`);
        continue;
      }
      seenTargets.add(to);
      ops.push({
        from,
        to,
        ...(typeof row.reason === "string" && row.reason.trim()
          ? { reason: row.reason.trim() }
          : {}),
      });
    }
    if (ops.length === 0) {
      return {
        ok: false,
        error: `没有可执行的操作。${problems.join("；")}`,
      };
    }
    const plan: PendingOrganizePlan = {
      planId: `org-${randomUUID()}`,
      matterId,
      ...(typeof params.goal === "string" && params.goal.trim()
        ? { goal: params.goal.trim() }
        : {}),
      ops,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    writePendingPlan(ctx.workspaceDir, plan);
    const existingNote = existing.size > 0 ? `当前材料 ${existing.size} 项。` : "";
    return {
      ok: true,
      data: {
        planId: plan.planId,
        matterId,
        status: "pending",
        opsCount: ops.length,
        planText: `整理计划（${ops.length} 项）：\n${formatPlanLines(ops)}`,
        ...(problems.length > 0 ? { skipped: problems } : {}),
        note: `${existingNote}请律师确认计划后调用 execute_organize_plan（plan_id=${plan.planId}）；未确认前不得执行。`,
      },
    };
  },
};

export const executeOrganizePlan: AgentTool = {
  definition: {
    name: "execute_organize_plan",
    description:
      "执行已确认的整理计划（仅限 propose_organize_plan 生成且律师已确认的计划）。逐条移动/重命名并写撤销日志。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
      plan_id: {
        type: "string",
        description: "propose_organize_plan 返回的 planId",
        required: true,
      },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string)?.trim() || ctx.matterId;
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const planId = typeof params.plan_id === "string" ? params.plan_id.trim() : "";
    const plan = readPendingPlan(ctx.workspaceDir, matterId);
    if (!plan || plan.planId !== planId) {
      return {
        ok: false,
        error: "找不到待执行的整理计划。请先 propose_organize_plan 并让律师确认。",
      };
    }
    const root = materialsRoot(ctx.workspaceDir, matterId);
    const applied: OrganizeFileOp[] = [];
    const failed: Array<{ op: OrganizeFileOp; error: string }> = [];
    for (const op of plan.ops) {
      const fromAbs = path.join(root, op.from);
      const toAbs = path.join(root, op.to);
      try {
        if (!fs.existsSync(fromAbs)) {
          throw new Error("源文件已不存在");
        }
        if (fs.existsSync(toAbs)) {
          throw new Error("目标已存在");
        }
        fs.mkdirSync(path.dirname(toAbs), { recursive: true });
        fs.renameSync(fromAbs, toAbs);
        applied.push(op);
      } catch (e) {
        failed.push({ op, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (applied.length === 0) {
      return {
        ok: false,
        error: `整理未执行：${failed.map((f) => `${f.op.from}（${f.error}）`).join("；")}`,
      };
    }
    const writeId = newDeskWriteId();
    appendDeskWrite(ctx.workspaceDir, {
      writeId,
      matterId,
      kind: "organize_files",
      createdAt: new Date().toISOString(),
      organizeOps: applied,
    });
    writePendingPlan(ctx.workspaceDir, { ...plan, status: "executed", writeId });
    return {
      ok: true,
      data: {
        planId,
        writeId,
        appliedCount: applied.length,
        applied: applied.map((op) => `${op.from} → ${op.to}`),
        ...(failed.length > 0 ? { failed: failed.map((f) => `${f.op.from}：${f.error}`) } : {}),
        note: `已整理 ${applied.length} 项。撤销：revert_desk_write（writeId=${writeId}）。`,
      },
    };
  },
};

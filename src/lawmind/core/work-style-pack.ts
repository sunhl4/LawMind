/**
 * Work-style pack — Role as a task-scoped work manner, not a hired persona.
 *
 * Product decision: docs/LAWMIND-SINGLE-PARENT-AGENT.md
 * Lawyers do not create an assistant per Role. Parent agent + draft_worker
 * inject checklist / mission / risk for this task; memory stays one cabinet.
 */

import { getRoleById, listRoles, type Role } from "./role.js";

export type SubagentWorkRole = "review" | "draft" | "explore";

export type WorkStylePack = {
  roleId: string;
  displayName: string;
  mission: string;
  riskCeiling: string;
  reviewChecklist: string[];
};

/** Map sidecar / draft_worker role → default Role id when no deliverable hint. */
export const SUBAGENT_DEFAULT_ROLE_ID: Record<SubagentWorkRole, string> = {
  review: "contract_review",
  draft: "general_default",
  explore: "general_default",
};

export function workStylePackFromRole(role: Role): WorkStylePack {
  return {
    roleId: role.roleId,
    displayName: role.displayName,
    mission: role.mission,
    riskCeiling: role.riskCeiling,
    reviewChecklist: [...role.reviewChecklist],
  };
}

export function resolveWorkStylePack(opts: {
  roleId?: string;
  subagentRole?: SubagentWorkRole;
  /** Optional deliverable / delivery intent hint, e.g. contract.review */
  deliveryHint?: string;
}): WorkStylePack | undefined {
  const explicit = opts.roleId?.trim();
  if (explicit) {
    const role = getRoleById(explicit);
    return role ? workStylePackFromRole(role) : undefined;
  }

  const hint = (opts.deliveryHint ?? "").toLowerCase();
  let inferredId: string | undefined;
  if (hint.includes("contract") || hint.includes("nda") || hint.includes("条款")) {
    inferredId = "contract_review";
  } else if (hint.includes("litigat") || hint.includes("诉讼") || hint.includes("仲裁")) {
    inferredId = "general_litigation";
  } else if (hint.includes("compliance") || hint.includes("合规") || hint.includes("research")) {
    inferredId = "compliance_research";
  } else if (hint.includes("client") || hint.includes("客户") || hint.includes("memo")) {
    inferredId = "client_memo";
  } else if (hint.includes("diligence") || hint.includes("尽调") || hint.includes("尽职")) {
    inferredId = "due_diligence";
  } else if (opts.subagentRole) {
    inferredId = SUBAGENT_DEFAULT_ROLE_ID[opts.subagentRole];
  }

  const role = getRoleById(inferredId) ?? listRoles().find((r) => r.roleId === "general_default");
  return role ? workStylePackFromRole(role) : undefined;
}

/**
 * Markdown block for system / brief. Keep short: checklist is the valuable part.
 * `forSubagent: review` omits lawyer writing-style coaching to reduce self-collusion.
 */
export function formatWorkStylePackBlock(
  pack: WorkStylePack,
  opts?: { forSubagent?: SubagentWorkRole },
): string {
  const lines: string[] = [
    `## 本轮工作方式（${pack.displayName}）`,
    `使命：${pack.mission}`,
    `风险上限：${pack.riskCeiling}。高于该等级的外发或改原稿须明确请律师确认。`,
  ];
  if (pack.reviewChecklist.length > 0) {
    lines.push("自检清单：");
    for (const item of pack.reviewChecklist) {
      lines.push(`- ${item}`);
    }
  }
  if (opts?.forSubagent === "review") {
    lines.push("本支为独立审查：按清单挑刺，不要迎合起草偏好；材料没有的事实写入待确认。");
  } else if (opts?.forSubagent === "explore") {
    lines.push("本支只探查材料与目录；不要起草或下审查结论。");
  } else if (opts?.forSubagent === "draft") {
    lines.push("本支只交回片段；改原件与外发留在父对话。");
  }
  return lines.join("\n");
}

/** L2 memory pack for draft_worker / explore_folder sidecars (task-scoped, not persona). */
export function buildSubagentMemoryPack(opts: {
  subagentRole: SubagentWorkRole;
  deliveryHint?: string;
  roleId?: string;
}): string {
  const pack = resolveWorkStylePack(opts);
  if (!pack) {
    return "";
  }
  return formatWorkStylePackBlock(pack, { forSubagent: opts.subagentRole });
}

/** Lawyer-facing note when Role has no separate assistant on the roster. */
export function workStyleFallbackMessage(pack: WorkStylePack): string {
  return [
    `当前没有独立承担「${pack.displayName}」的助手。`,
    "请按下列工作方式在本对话自行办理，或用 draft_worker 开隔离子工；不要要求律师新建助手。",
    "",
    formatWorkStylePackBlock(pack),
  ].join("\n");
}

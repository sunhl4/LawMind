/**
 * 新案线索：没有可靠案件候选的来件，由律师推进收案。
 *
 * 这一层刻意只做「律师决定」的记账：
 * - 系统永远不会自动把来件变成线索，也不会自动接受委托；
 * - `accepted` 只创建一个 `intake` 状态的案件，`intake → active` 仍由 P1 收案闸门控制；
 * - 线索阶段的推进不动物件内容，进入收案时才把原文与附件物化进案件目录。
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { admissionCandidatesFromItem, createAdmission, type AdmissionRecord } from "./admission.js";
import { attachIntakeItem } from "./filing.js";
import { appendIntakeEvent, getIntakeItem, updateIntakeItem } from "./store.js";
import type { IntakeItem, IntakeLeadStage } from "./types.js";

export type IntakeLeadError =
  | "not_found"
  | "not_pending"
  | "already_accepted"
  | "lead_closed"
  | "invalid_matter_title"
  | "matter_exists"
  | "matter_create_failed"
  | "admission_create_failed"
  | "attach_failed";

export type IntakeLeadResult =
  | { ok: true; item: IntakeItem; admission?: AdmissionRecord }
  | { ok: false; error: IntakeLeadError };

const STAGE_LABEL: Record<IntakeLeadStage, string> = {
  new: "新案线索",
  needs_info: "待补资料",
  conflict_pending: "待冲突检查",
  declined: "已婉拒",
  accepted: "已进入收案",
};

export function intakeLeadStageLabel(stage: IntakeLeadStage | undefined): string {
  return stage ? STAGE_LABEL[stage] : "";
}

function canMove(from: IntakeLeadStage | undefined, to: IntakeLeadStage): boolean {
  const current = from ?? "new";
  if (current === "accepted") {
    return false;
  }
  if (current === "declined") {
    // 婉拒后可以重新打开，但不能直接进入收案。
    return to === "new";
  }
  return true;
}

/**
 * 律师手工推进线索阶段（不含进入收案）。
 *
 * `declined` 同时把来件标成 `ignored`，让它从「停在你这里」离开；
 * 其他阶段仍留在待归案队列里，等律师下一步处置。
 */
export function setIntakeLeadStage(
  workspaceDir: string,
  itemId: string,
  stage: Exclude<IntakeLeadStage, "accepted">,
  opts?: { note?: string; now?: Date },
): IntakeLeadResult {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (item.status !== "pending") {
    return { ok: false, error: "not_pending" };
  }
  if (!canMove(item.lead?.stage, stage)) {
    return {
      ok: false,
      error: item.lead?.stage === "accepted" ? "already_accepted" : "lead_closed",
    };
  }
  const at = (opts?.now ?? new Date()).toISOString();
  const note = opts?.note?.trim().slice(0, 500);
  const updated = updateIntakeItem(workspaceDir, itemId, (current) => {
    if (current.status !== "pending") {
      return undefined;
    }
    const next: IntakeItem = {
      ...current,
      lead: {
        stage,
        at,
        by: "lawyer",
        ...(note ? { note } : {}),
      },
    };
    if (stage === "declined") {
      next.status = "ignored";
      next.ignoredAt = at;
    }
    return next;
  });
  if (!updated) {
    return { ok: false, error: "not_pending" };
  }
  appendIntakeEvent(workspaceDir, {
    at,
    itemId,
    kind: "lead",
    by: "lawyer",
    detail: stage,
  });
  return { ok: true, item: updated };
}

/**
 * 进入收案：用律师给的名称建一个 `intake` 案件，再把来件归进去。
 *
 * 名称同时充当 `matterId`（沿用「文件夹名 = 案件名」的约定）。同名案件已存在时
 * 直接拒绝：不能把一封新来件并进已有案件，那等于绕过收案与冲突检查。
 */
export function acceptIntakeLead(
  workspaceDir: string,
  itemId: string,
  matterTitle: string,
  opts?: { now?: Date; ownerLawyerId?: string },
): IntakeLeadResult {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (item.status !== "pending") {
    return { ok: false, error: "not_pending" };
  }
  if (item.lead?.stage === "accepted") {
    return { ok: false, error: "already_accepted" };
  }
  if (item.lead?.stage === "declined") {
    return { ok: false, error: "lead_closed" };
  }
  const title = matterTitle.trim();
  if (!title || !isValidMatterId(title)) {
    return { ok: false, error: "invalid_matter_title" };
  }
  const now = opts?.now ?? new Date();
  const at = now.toISOString();
  if (loadMatter(workspaceDir, title)) {
    // 已有同名案件：不能把新来件并进去，那等于绕过收案与冲突检查。
    return { ok: false, error: "matter_exists" };
  }
  try {
    createMatterIfMissing(workspaceDir, {
      matterId: title,
      title,
      // 只建收案中的案件；`intake → active` 由 P1 收案闸门决定。
      status: "intake",
      ...(opts?.ownerLawyerId ? { ownerLawyerId: opts.ownerLawyerId } : {}),
    });
  } catch {
    return { ok: false, error: "matter_create_failed" };
  }
  // 收案记录与案件同时建立：从这一刻起，外发闸门只认 `accepted`。
  const admission = createAdmission(workspaceDir, {
    matterId: title,
    matterTitle: title,
    sourceItemIds: [itemId],
    candidates: admissionCandidatesFromItem(item),
    ...(opts?.ownerLawyerId ? { ownerLawyerId: opts.ownerLawyerId } : {}),
    now,
  });
  if (!admission.ok) {
    return { ok: false, error: "admission_create_failed" };
  }
  const filed = attachIntakeItem(workspaceDir, itemId, title, { by: "lawyer", now });
  if (!filed.ok) {
    return { ok: false, error: "attach_failed" };
  }
  const updated = updateIntakeItem(workspaceDir, itemId, (current) => ({
    ...current,
    lead: {
      stage: "accepted",
      at,
      by: "lawyer",
      matterId: title,
    },
  }));
  if (!updated) {
    return { ok: false, error: "not_found" };
  }
  appendIntakeEvent(workspaceDir, {
    at,
    itemId,
    kind: "lead",
    by: "lawyer",
    matterId: title,
    detail: "accepted",
  });
  return { ok: true, item: updated, admission: admission.admission };
}

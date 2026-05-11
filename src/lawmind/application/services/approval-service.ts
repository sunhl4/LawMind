/**
 * Approval Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/approvals.jsonl`。
 *
 * `targetRole` 字段在 W3 已写入 schema，W8 起 `delegateToRole` / 桌面待审批
 * 列表会按 role 过滤。
 */

import { randomUUID } from "node:crypto";
import {
  appendApproval,
  readApprovals,
  rewriteApprovals,
  type ApprovalRecord,
} from "../../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "./matter-write-service.js";

function newTimestamp(): string {
  return new Date().toISOString();
}

export type RequestApprovalInput = {
  matterId: string;
  deliverableId?: string;
  requestedBy: string;
  requestedRole?: string;
  targetRole?: string;
  reason: string;
  riskLevel: ApprovalRecord["riskLevel"];
  approvalId?: string;
};

export function requestApproval(workspaceDir: string, input: RequestApprovalInput): ApprovalRecord {
  createMatterIfMissing(workspaceDir, { matterId: input.matterId });
  const record: ApprovalRecord = {
    approvalId: input.approvalId ?? randomUUID(),
    matterId: input.matterId,
    deliverableId: input.deliverableId,
    requestedBy: input.requestedBy,
    requestedRole: input.requestedRole,
    targetRole: input.targetRole,
    requestedAt: newTimestamp(),
    reason: input.reason,
    riskLevel: input.riskLevel,
    status: "pending",
  };
  appendApproval(workspaceDir, record);
  return record;
}

export function listPendingApprovals(
  workspaceDir: string,
  matterId: string,
  opts?: { targetRole?: string },
): ApprovalRecord[] {
  return readApprovals(workspaceDir, matterId).filter(
    (a) => a.status === "pending" && (opts?.targetRole ? a.targetRole === opts.targetRole : true),
  );
}

export function listApprovals(workspaceDir: string, matterId: string): ApprovalRecord[] {
  return readApprovals(workspaceDir, matterId);
}

export function resolveApproval(
  workspaceDir: string,
  matterId: string,
  approvalId: string,
  resolution: { status: Exclude<ApprovalRecord["status"], "pending">; resolvedBy: string },
): ApprovalRecord | undefined {
  const all = readApprovals(workspaceDir, matterId);
  const idx = all.findIndex((a) => a.approvalId === approvalId);
  if (idx < 0) {
    return undefined;
  }
  const next: ApprovalRecord = {
    ...all[idx],
    status: resolution.status,
    resolvedBy: resolution.resolvedBy,
    resolvedAt: newTimestamp(),
  };
  all[idx] = next;
  rewriteApprovals(workspaceDir, matterId, all);
  return next;
}

export type { ApprovalRecord };

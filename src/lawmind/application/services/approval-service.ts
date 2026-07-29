/**
 * Approval Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/approvals.jsonl`。
 *
 * `targetRole` 字段在 W3 已写入 schema，W8 起 `delegateToRole` / 桌面待审批
 * 列表会按 role 过滤。
 *
 * `resolveApproval` 使用文件锁 + compare-and-swap（仅 pending → 终态），避免并发双写翻转。
 * CAS 输家返回 `already_resolved`（勿当作本请求写入成功）。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendApproval,
  matterDir,
  readApprovals,
  rewriteApprovals,
  type ApprovalRecord,
} from "../../adapters/matter-storage/index.js";
import { withExclusiveFileLock } from "../../adapters/matter-storage/io.js";
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

/** 本请求成功写入终态。 */
export type ResolveApprovalWritten = {
  outcome: "written";
  approval: ApprovalRecord;
};

/** CAS 输家：审批已是终态；`approval` 为当前真相（赢家状态）。 */
export type ResolveApprovalAlreadyResolved = {
  outcome: "already_resolved";
  approval: ApprovalRecord;
};

export type ResolveApprovalNotFound = {
  outcome: "not_found";
};

export type ResolveApprovalResult =
  | ResolveApprovalWritten
  | ResolveApprovalAlreadyResolved
  | ResolveApprovalNotFound;

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
): ResolveApprovalResult {
  const lockPath = path.join(matterDir(workspaceDir, matterId), "approvals.jsonl.lock");
  return withExclusiveFileLock(lockPath, () => {
    const all = readApprovals(workspaceDir, matterId);
    const idx = all.findIndex((a) => a.approvalId === approvalId);
    if (idx < 0) {
      return { outcome: "not_found" as const };
    }
    const current = all[idx];
    // Compare-and-swap: only pending may transition; concurrent losers keep winner status.
    if (current.status !== "pending") {
      return { outcome: "already_resolved" as const, approval: current };
    }
    const next: ApprovalRecord = {
      ...current,
      status: resolution.status,
      resolvedBy: resolution.resolvedBy,
      resolvedAt: newTimestamp(),
    };
    all[idx] = next;
    rewriteApprovals(workspaceDir, matterId, all);
    return { outcome: "written" as const, approval: next };
  });
}

export type { ApprovalRecord };

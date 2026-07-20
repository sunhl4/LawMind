/**
 * Deliverable Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/deliverables/<deliverableId>.json`。
 *
 * 注意：W3 引入时仍与 ArtifactDraft（`workspace/drafts/`）双轨；engine
 * `persistDraftPipeline` 在 W4 接入本 service 后，每条 draft 会同时写入
 * Markdown / TaskRecord / Deliverable 三处。
 */

import {
  loadDeliverable,
  saveDeliverable,
  type DeliverableRecord,
} from "../../adapters/matter-storage/index.js";
import { buildDeliverableFromDraft } from "../../core/contracts.js";
import { canTransitionDeliverable } from "../../core/deliverable-lifecycle.js";
import type { ArtifactDraft, ReviewStatus, TaskRecord } from "../../types.js";
import { attachDeliverableId, createMatterIfMissing } from "./matter-write-service.js";

function newTimestamp(): string {
  return new Date().toISOString();
}

export type CreatePlannedDeliverableInput = {
  matterId: string;
  deliverableId: string;
  taskId?: string;
  kind: DeliverableRecord["kind"];
  audience?: DeliverableRecord["audience"];
  templateId?: string;
  ownerLawyerId?: string;
  reviewerId?: string;
};

export function createPlannedDeliverable(
  workspaceDir: string,
  input: CreatePlannedDeliverableInput,
): DeliverableRecord {
  createMatterIfMissing(workspaceDir, { matterId: input.matterId });
  const now = newTimestamp();
  const record: DeliverableRecord = {
    deliverableId: input.deliverableId,
    matterId: input.matterId,
    taskId: input.taskId,
    kind: input.kind,
    audience: input.audience ?? "unknown",
    status: "planned",
    templateId: input.templateId,
    ownerLawyerId: input.ownerLawyerId,
    reviewerId: input.reviewerId,
    blockingReasons: [],
    createdAt: now,
    updatedAt: now,
  };
  saveDeliverable(workspaceDir, record);
  attachDeliverableId(workspaceDir, input.matterId, input.deliverableId);
  return record;
}

export function transitionDeliverable(
  workspaceDir: string,
  matterId: string,
  deliverableId: string,
  status: DeliverableRecord["status"],
  opts?: {
    reviewStatus?: ReviewStatus;
    templateId?: string;
    blockingReasons?: string[];
    reviewerId?: string;
    approvedBy?: string;
    deliveredBy?: string;
  },
): DeliverableRecord | undefined {
  const existing = loadDeliverable(workspaceDir, matterId, deliverableId);
  if (!existing) {
    return undefined;
  }
  if (!canTransitionDeliverable(existing.status, status)) {
    throw new Error(`invalid deliverable transition: ${existing.status} -> ${status}`);
  }
  const next: DeliverableRecord = {
    ...existing,
    status,
    currentReviewStatus: opts?.reviewStatus ?? existing.currentReviewStatus,
    templateId: opts?.templateId ?? existing.templateId,
    blockingReasons: opts?.blockingReasons ?? existing.blockingReasons,
    reviewerId: opts?.reviewerId ?? existing.reviewerId,
    approvedBy: opts?.approvedBy ?? existing.approvedBy,
    deliveredBy: opts?.deliveredBy ?? existing.deliveredBy,
    deliveredAt:
      status === "delivered" ? (existing.deliveredAt ?? newTimestamp()) : existing.deliveredAt,
    updatedAt: newTimestamp(),
  };
  saveDeliverable(workspaceDir, next);
  return next;
}

/** 把现有 ArtifactDraft 落到 deliverables/ 真相源（与 Markdown 并存）。 */
export function linkDraftToDeliverable(
  workspaceDir: string,
  draft: ArtifactDraft,
  task?: TaskRecord,
): DeliverableRecord | undefined {
  const derived = buildDeliverableFromDraft(draft, task);
  if (!derived) {
    return undefined;
  }
  createMatterIfMissing(workspaceDir, { matterId: derived.matterId });
  const existing = loadDeliverable(workspaceDir, derived.matterId, derived.deliverableId);
  const merged: DeliverableRecord = existing
    ? { ...existing, ...derived, updatedAt: newTimestamp() }
    : { ...derived, updatedAt: newTimestamp() };
  saveDeliverable(workspaceDir, merged);
  attachDeliverableId(workspaceDir, merged.matterId, merged.deliverableId);
  return merged;
}

export { loadDeliverable as readDeliverable };
export type { DeliverableRecord };

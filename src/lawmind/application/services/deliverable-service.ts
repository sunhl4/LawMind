/**
 * Deliverable Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/deliverables/<deliverableId>.json`。
 *
 * 注意：W3 引入时仍与 ArtifactDraft（`workspace/drafts/`）双轨；engine
 * `persistDraftPipeline` 在 W4 接入本 service 后，每条 draft 会同时写入
 * Markdown / TaskRecord / Deliverable 三处。
 */

import path from "node:path";
import {
  loadDeliverable,
  saveDeliverable,
  type DeliverableRecord,
} from "../../adapters/matter-storage/index.js";
import { matterDir, withExclusiveFileLock } from "../../adapters/matter-storage/io.js";
import { buildDeliverableFromDraft } from "../../core/contracts.js";
import { canTransitionDeliverable } from "../../core/deliverable-lifecycle.js";
import type { ArtifactDraft, ReviewStatus, TaskRecord } from "../../types.js";
import { attachDeliverableId, createMatterIfMissing } from "./matter-write-service.js";

function newTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Per-deliverable exclusive lock around `deliverables/<id>.json` read-modify-write.
 * Prevents concurrent transitions / stamp writes / draft links from clobbering
 * each other's status or review-stamp fields.
 */
function withDeliverableLock<T>(
  workspaceDir: string,
  matterId: string,
  deliverableId: string,
  fn: () => T,
): T {
  const lockPath = path.join(
    matterDir(workspaceDir, matterId),
    "deliverables",
    `${deliverableId}.json.lock`,
  );
  return withExclusiveFileLock(lockPath, fn);
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
  return withDeliverableLock(workspaceDir, matterId, deliverableId, () => {
    const existing = loadDeliverable(workspaceDir, matterId, deliverableId);
    if (!existing) {
      return undefined;
    }
    if (!canTransitionDeliverable(existing.status, status)) {
      throw new Error(`invalid deliverable transition: ${existing.status} -> ${status}`);
    }
    // SSOT: terminal review stamps (approved/rejected) must not be overwritten by a
    // drifted draft.reviewStatus on later lifecycle transitions (e.g. render).
    // pending → approved still takes opts.reviewStatus via applyDeliverableReviewStamp
    // or an explicit non-regressing transition.
    const terminalStamp =
      existing.currentReviewStatus === "approved" || existing.currentReviewStatus === "rejected";
    const next: DeliverableRecord = {
      ...existing,
      status,
      currentReviewStatus: terminalStamp
        ? existing.currentReviewStatus
        : (opts?.reviewStatus ?? existing.currentReviewStatus),
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
  });
}

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
  return withDeliverableLock(workspaceDir, derived.matterId, derived.deliverableId, () => {
    const existing = loadDeliverable(workspaceDir, derived.matterId, derived.deliverableId);
    // SSOT: once a review stamp exists on deliverable JSON, draft re-link must not
    // overwrite currentReviewStatus / lifecycle (R-P2-7 hardening).
    const stampLocked =
      existing != null &&
      (existing.currentReviewStatus != null ||
        existing.status === "approved" ||
        existing.status === "rendered" ||
        existing.status === "delivered");
    const merged: DeliverableRecord = existing
      ? {
          ...existing,
          ...derived,
          currentReviewStatus: existing.currentReviewStatus ?? derived.currentReviewStatus,
          reviewerId: existing.reviewerId ?? derived.reviewerId,
          approvedBy: existing.approvedBy ?? derived.approvedBy,
          blockingReasons: stampLocked
            ? (existing.blockingReasons ?? derived.blockingReasons)
            : (derived.blockingReasons ?? existing.blockingReasons),
          status: stampLocked ? existing.status : derived.status,
          deliveredAt: existing.deliveredAt ?? derived.deliveredAt,
          deliveredBy: existing.deliveredBy ?? derived.deliveredBy,
          updatedAt: newTimestamp(),
        }
      : { ...derived, updatedAt: newTimestamp() };
    saveDeliverable(workspaceDir, merged);
    attachDeliverableId(workspaceDir, merged.matterId, merged.deliverableId);
    return merged;
  });
}

/**
 * High-risk review-stamp write mouth (R-P2-7).
 *
 * Authority: `matters/<id>/deliverables/<id>.json` (`currentReviewStatus`).
 * The linked draft's `reviewStatus` is synced FROM that stamp (not the reverse),
 * so Doctor `deliverable_review_drift` stays green after this path.
 */
export function applyDeliverableReviewStamp(
  workspaceDir: string,
  matterId: string,
  deliverableId: string,
  stamp: {
    reviewStatus: ReviewStatus;
    status: DeliverableRecord["status"];
    reviewerId?: string;
    approvedBy?: string;
    blockingReasons?: string[];
  },
): DeliverableRecord | undefined {
  return withDeliverableLock(workspaceDir, matterId, deliverableId, () => {
    const existing = loadDeliverable(workspaceDir, matterId, deliverableId);
    if (!existing) {
      return undefined;
    }
    if (
      existing.status !== stamp.status &&
      !canTransitionDeliverable(existing.status, stamp.status)
    ) {
      // Still converge the review stamp even if lifecycle skip is illegal —
      // stamp is the high-risk dual-truth field; lifecycle stays guarded elsewhere.
      const stamped: DeliverableRecord = {
        ...existing,
        currentReviewStatus: stamp.reviewStatus,
        reviewerId: stamp.reviewerId ?? existing.reviewerId,
        approvedBy: stamp.approvedBy ?? existing.approvedBy,
        blockingReasons: stamp.blockingReasons ?? existing.blockingReasons,
        updatedAt: newTimestamp(),
      };
      saveDeliverable(workspaceDir, stamped);
      return stamped;
    }
    const next: DeliverableRecord = {
      ...existing,
      status: stamp.status,
      currentReviewStatus: stamp.reviewStatus,
      reviewerId: stamp.reviewerId ?? existing.reviewerId,
      approvedBy: stamp.approvedBy ?? existing.approvedBy,
      blockingReasons: stamp.blockingReasons ?? existing.blockingReasons,
      deliveredAt:
        stamp.status === "delivered"
          ? (existing.deliveredAt ?? newTimestamp())
          : existing.deliveredAt,
      updatedAt: newTimestamp(),
    };
    saveDeliverable(workspaceDir, next);
    return next;
  });
}

/** Sync draft.reviewStatus from deliverable JSON authority (no-op if no stamp). */
export function syncDraftReviewStatusFromDeliverable(
  draft: ArtifactDraft,
  deliverable: DeliverableRecord,
): ArtifactDraft {
  const stamp = deliverable.currentReviewStatus;
  if (!stamp) {
    return draft;
  }
  draft.reviewStatus = stamp;
  return draft;
}

export { loadDeliverable as readDeliverable };
export type { DeliverableRecord };

/**
 * Force peer-review gate before lawyer queue (Wave B / T3.2).
 */

import { emitCollaborationEvent } from "../agent/collaboration/audit.js";
import {
  buildDelegationEvent,
  registerDelegation,
} from "../agent/collaboration/delegation-registry.js";
import { getAssistantById, resolveLawMindRoot } from "../assistants/store.js";
import { emit } from "../audit/index.js";
import type { ArtifactDraft } from "../types.js";
import { effectiveForcePeerReview } from "./defaults.js";

export type PeerReviewGateResult = {
  applied: boolean;
  skippedReason?: "edition_off" | "no_author" | "no_peer" | "self_peer" | "error";
  peerAssistantId?: string;
  delegationId?: string;
};

/**
 * When force peer review is effective and the author has a peer, register a
 * pending delegation for peer review (does not auto-run an agent turn).
 * Caller still opens the lawyer queue; title should mention 互审 when applied.
 */
export function maybeApplyForcedPeerReview(params: {
  workspaceDir: string;
  auditDir: string;
  draft: ArtifactDraft;
  authorAssistantId?: string;
  envFile?: string;
}): PeerReviewGateResult {
  const { workspaceDir, auditDir, draft } = params;
  try {
    if (!effectiveForcePeerReview({ workspaceDir })) {
      return { applied: false, skippedReason: "edition_off" };
    }
    const authorId = params.authorAssistantId?.trim();
    if (!authorId) {
      void emit(auditDir, {
        taskId: draft.taskId,
        kind: "draft.peer_review_skipped",
        actor: "system",
        detail: JSON.stringify({ reason: "no_author" }),
      }).catch(() => {});
      return { applied: false, skippedReason: "no_author" };
    }
    const root = resolveLawMindRoot(workspaceDir, params.envFile);
    const author = getAssistantById(root, authorId);
    const peerId = author?.peerReviewDefaultAssistantId?.trim();
    if (!peerId) {
      void emit(auditDir, {
        taskId: draft.taskId,
        kind: "draft.peer_review_skipped",
        actor: "system",
        detail: JSON.stringify({ reason: "no_peer", authorId }),
      }).catch(() => {});
      return { applied: false, skippedReason: "no_peer" };
    }
    if (peerId === authorId) {
      void emit(auditDir, {
        taskId: draft.taskId,
        kind: "draft.peer_review_skipped",
        actor: "system",
        detail: JSON.stringify({ reason: "self_peer", authorId }),
      }).catch(() => {});
      return { applied: false, skippedReason: "self_peer" };
    }
    const peer = getAssistantById(root, peerId);
    if (!peer) {
      void emit(auditDir, {
        taskId: draft.taskId,
        kind: "draft.peer_review_skipped",
        actor: "system",
        detail: JSON.stringify({ reason: "no_peer", authorId, peerId }),
      }).catch(() => {});
      return { applied: false, skippedReason: "no_peer" };
    }

    const task = [
      `【强制互审】请审阅草稿「${draft.title}」（任务 ${draft.taskId}）。`,
      "对照本所口径与作者角色职责，标出必须修改项与可放行项；完成后交律师签批。",
      draft.matterId ? `案件：${draft.matterId}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const record = registerDelegation({
      workspaceDir,
      fromAssistantId: authorId,
      toAssistantId: peerId,
      task,
      matterId: draft.matterId,
      priority: "high",
    });
    emitCollaborationEvent(workspaceDir, buildDelegationEvent(record, "delegation.created"));
    void emit(auditDir, {
      taskId: draft.taskId,
      kind: "draft.peer_review_required",
      actor: "system",
      detail: JSON.stringify({
        authorId,
        peerAssistantId: peerId,
        delegationId: record.delegationId,
      }),
    }).catch(() => {});

    return {
      applied: true,
      peerAssistantId: peerId,
      delegationId: record.delegationId,
    };
  } catch {
    return { applied: false, skippedReason: "error" };
  }
}

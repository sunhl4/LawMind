/**
 * After the lawyer answers a paused collaboration child, close the delegation.
 * The desktop job runner separately continues a workflow that was waiting on this session.
 */

import { appendSyntheticAssistantReply, loadSession } from "../session.js";
import { formatDelegationParentFollowUp } from "../tools/coordination/delegate.js";
import {
  getDelegation,
  markDelegationAwaitingLawyer,
  markDelegationCompleted,
  markDelegationFailed,
  restoreDelegationsFromDisk,
} from "./delegation-registry.js";

function turnStillWaiting(status: string): boolean {
  return (
    status === "awaiting_clarification" || status === "awaiting_approval" || status === "paused"
  );
}

export function settleCollaborationChildTurn(params: {
  workspaceDir: string;
  sessionId: string;
  status: string;
  reply: string;
}): void {
  const session = loadSession(params.workspaceDir, params.sessionId);
  const delegationId = session?.collaborationDelegationId?.trim();
  if (!delegationId) {
    return;
  }
  let record = getDelegation(delegationId);
  if (!record) {
    restoreDelegationsFromDisk(params.workspaceDir);
    record = getDelegation(delegationId);
  }
  if (!record) {
    return;
  }
  if (
    record.status !== "awaiting_lawyer" &&
    record.status !== "running" &&
    record.status !== "pending"
  ) {
    return;
  }
  if (turnStillWaiting(params.status)) {
    markDelegationAwaitingLawyer(
      params.workspaceDir,
      delegationId,
      "对方仍在等你确认。请在「在办」里回答。",
    );
    return;
  }
  if (params.status === "completed") {
    const reply = params.reply.trim() || record.result || "已按你的确认办完。";
    const updated = markDelegationCompleted(
      params.workspaceDir,
      delegationId,
      reply,
      params.sessionId,
    );
    if (updated?.parentSessionId && updated.status === "completed") {
      appendSyntheticAssistantReply(
        params.workspaceDir,
        updated.parentSessionId,
        formatDelegationParentFollowUp(updated, updated.result ?? reply, true),
      );
    }
    return;
  }
  if (params.status === "error") {
    markDelegationFailed(
      params.workspaceDir,
      delegationId,
      params.reply.trim() || "这一步没有办完。",
    );
  }
}

/**
 * Session delete + optional cascade of chat-owned artifacts.
 * Always removes session runtime files; cascade is opt-in for delegations / unapproved drafts.
 *
 * 递归语义：cascadeDelegations 开启时，子会话沿委派链递归级联（visited 防环），
 * 包括孙委派与子会话绑定的未受保护草稿（当 cascadeUnapprovedDrafts 同开）。
 * 明确不删：审计（audit/*.jsonl）、模型用量账本（model-usage）、matter 侧产物
 * （matters/、cases/ 下案件材料与交付物）——这些属于工作区证据链，不随会话删除。
 */

import fs from "node:fs";
import path from "node:path";
import { delegationTranscriptPath, transcriptPath } from "../adapters/session-transcript/index.js";
import { deleteDraft, readDraft } from "../drafts/index.js";
import { deleteTaskRecord, listTaskRecords } from "../tasks/index.js";
import {
  cancelDelegation,
  deleteDelegationRecord,
  listDelegations,
  restoreDelegationsFromDisk,
} from "./collaboration/delegation-registry.js";
import { clearLiveTurnProgress } from "./live-turn-progress.js";
import { deleteSession, loadSession } from "./session.js";

export type SessionDeleteCascadeOptions = {
  /** Cancel/remove delegations spawned from this chat + child sessions. */
  cascadeDelegations?: boolean;
  /** Delete drafts tied to this sessionId when not approved / not exported. */
  cascadeUnapprovedDrafts?: boolean;
};

export type SessionDeleteCascadeResult = {
  deletedSession: boolean;
  deletedTranscript: boolean;
  cancelledDelegations: number;
  deletedChildSessions: number;
  deletedTasks: number;
  deletedDrafts: number;
};

function unlinkIfExists(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    /* best-effort */
  }
  return false;
}

function isDraftProtected(taskId: string, workspaceDir: string): boolean {
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return false;
  }
  const status = draft.reviewStatus ?? "pending";
  if (status === "approved") {
    return true;
  }
  if (draft.outputPath?.trim()) {
    return true;
  }
  return false;
}

/**
 * Delete a chat session and always clean runtime sidecars.
 * When cascade flags are set, also remove chat-owned delegations / unapproved drafts.
 */
export function deleteSessionWithCascade(
  workspaceDir: string,
  sessionId: string,
  opts: SessionDeleteCascadeOptions = {},
): SessionDeleteCascadeResult {
  return deleteSessionWithCascadeInner(workspaceDir, sessionId, opts, new Set());
}

function deleteSessionWithCascadeInner(
  workspaceDir: string,
  sessionId: string,
  opts: SessionDeleteCascadeOptions,
  visited: Set<string>,
): SessionDeleteCascadeResult {
  const result: SessionDeleteCascadeResult = {
    deletedSession: false,
    deletedTranscript: false,
    cancelledDelegations: 0,
    deletedChildSessions: 0,
    deletedTasks: 0,
    deletedDrafts: 0,
  };
  if (visited.has(sessionId)) {
    return result;
  }
  visited.add(sessionId);

  const session = loadSession(workspaceDir, sessionId);
  clearLiveTurnProgress(sessionId);

  if (opts.cascadeDelegations) {
    try {
      restoreDelegationsFromDisk(workspaceDir);
    } catch {
      /* optional */
    }
    const dels = listDelegations({ parentSessionId: sessionId });
    const collabId = session?.collaborationDelegationId?.trim();
    const seen = new Set(dels.map((d) => d.delegationId));
    if (collabId && !seen.has(collabId)) {
      dels.push(...listDelegations().filter((d) => d.delegationId === collabId));
    }
    for (const d of dels) {
      cancelDelegation(workspaceDir, d.delegationId);
      const childId = d.targetSessionId?.trim();
      if (childId && childId !== sessionId && !visited.has(childId)) {
        // 递归级联：子会话沿委派链下钻（孙委派、子会话绑定草稿），visited 防环。
        const child = deleteSessionWithCascadeInner(workspaceDir, childId, opts, visited);
        result.deletedChildSessions += child.deletedSession ? 1 : 0;
        result.deletedChildSessions += child.deletedChildSessions;
        result.cancelledDelegations += child.cancelledDelegations;
        result.deletedTasks += child.deletedTasks;
        result.deletedDrafts += child.deletedDrafts;
      }
      unlinkIfExists(delegationTranscriptPath(workspaceDir, d.delegationId));
      if (deleteDelegationRecord(workspaceDir, d.delegationId)) {
        result.cancelledDelegations += 1;
      }
    }
  }

  if (opts.cascadeUnapprovedDrafts) {
    const tasks = listTaskRecords(workspaceDir).filter((t) => t.sessionId === sessionId);
    for (const t of tasks) {
      const draft = readDraft(workspaceDir, t.taskId);
      if (!draft) {
        continue;
      }
      if (isDraftProtected(t.taskId, workspaceDir)) {
        continue;
      }
      if (deleteDraft(workspaceDir, t.taskId)) {
        result.deletedDrafts += 1;
      }
      if (deleteTaskRecord(workspaceDir, t.taskId)) {
        result.deletedTasks += 1;
      }
    }
  }

  result.deletedTranscript = unlinkIfExists(transcriptPath(workspaceDir, sessionId));
  result.deletedSession = deleteSession(workspaceDir, sessionId) || result.deletedTranscript;

  try {
    const dir = path.join(workspaceDir, "sessions");
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`${sessionId}.`) && name.endsWith(".jsonl")) {
        unlinkIfExists(path.join(dir, name));
      }
    }
  } catch {
    /* optional */
  }

  return result;
}

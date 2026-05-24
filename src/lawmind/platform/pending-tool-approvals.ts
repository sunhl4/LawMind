/**
 * Workspace-wide pending tool_approval items (ProWorkBench-style approval queue).
 */

import { listSessions } from "../agent/session.js";
import type { LawMindRequiresAction } from "./requires-action.js";

export type PendingToolApprovalItem = {
  actionId: string;
  sessionId: string;
  matterId?: string;
  toolName?: string;
  title: string;
  summary: string;
  toolArgs?: Record<string, unknown>;
  createdAt: string;
};

export function listPendingToolApprovals(
  workspaceDir: string,
  opts?: { matterId?: string },
): PendingToolApprovalItem[] {
  const mid = opts?.matterId?.trim();
  const out: PendingToolApprovalItem[] = [];
  for (const session of listSessions(workspaceDir)) {
    if (mid && session.matterId !== mid) {
      continue;
    }
    const pending = session.pendingRequiresAction ?? [];
    for (const raw of pending) {
      if (!isToolApproval(raw)) {
        continue;
      }
      out.push({
        actionId: raw.id,
        sessionId: session.sessionId,
        matterId: session.matterId,
        toolName: raw.toolName,
        title: raw.title,
        summary: raw.summary,
        toolArgs: raw.toolArgs,
        createdAt: raw.createdAt,
      });
    }
  }
  return out.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function isToolApproval(a: LawMindRequiresAction): boolean {
  return a.kind === "tool_approval";
}

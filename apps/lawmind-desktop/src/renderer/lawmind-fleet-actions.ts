/**
 * 在办：合并会话/工作区/案件审批为统一 RequiresAction 列表（从 FleetPanel 抽出）。
 */

import type { ApprovalRequest } from "../../../../src/lawmind/core/contracts.ts";
import type { LawMindRequiresAction } from "./lawmind-requires-action";
import type { ActionSummaryPayload } from "./lawmind-requires-action";

/** Flatten workspace chatRequiresActions with sessionId stamped; dedupe by id. */
export function flattenWorkspaceChatActions(
  summary: ActionSummaryPayload | null | undefined,
): LawMindRequiresAction[] {
  const rows = summary?.chatRequiresActions ?? [];
  const out: LawMindRequiresAction[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const a of row.actions) {
      if (seen.has(a.id)) {
        continue;
      }
      seen.add(a.id);
      out.push({ ...a, sessionId: a.sessionId ?? row.sessionId });
    }
  }
  return out;
}

/** Map pending matter approvals into RequiresAction rows. */
export function matterApprovalsToActions(
  approvals: ApprovalRequest[] | undefined,
): LawMindRequiresAction[] {
  return (approvals ?? [])
    .filter((a) => a.status === "pending")
    .map((a) => ({
      id: a.approvalId,
      kind: "matter_approval" as const,
      threadId: `${a.matterId}::_::_`,
      title: "案件待审批",
      summary: a.reason,
      matterId: a.matterId,
      approvalId: a.approvalId,
      decisions: ["approve", "reject"],
      createdAt: a.requestedAt,
    }));
}

export type CollectFleetActionsInput = {
  summary: ActionSummaryPayload | null | undefined;
  currentSessionId?: string;
  shellSessionId?: string;
  runActions: LawMindRequiresAction[];
  sessionRequiresActions: LawMindRequiresAction[];
};

/**
 * Build the action pool for the selected fleet run:
 * - when a run session is selected: run transcript + matching workspace + shell session actions
 * - else: all workspace + shell session actions
 * Always appends pending matter approvals. Dedupes by action id.
 */
export function collectFleetActions(input: CollectFleetActionsInput): LawMindRequiresAction[] {
  const workspaceChatActions = flattenWorkspaceChatActions(input.summary);
  const approvals = (input.summary as { approvals?: ApprovalRequest[] } | null | undefined)
    ?.approvals;
  const matterActions = matterApprovalsToActions(approvals);
  const sid = input.currentSessionId?.trim();
  const chatPool = sid
    ? [
        ...input.runActions,
        ...workspaceChatActions.filter((a) => a.sessionId === sid),
        ...(input.shellSessionId === sid ? input.sessionRequiresActions : []),
      ]
    : [...workspaceChatActions, ...input.sessionRequiresActions];
  const seen = new Set<string>();
  const out: LawMindRequiresAction[] = [];
  for (const a of [...chatPool, ...matterActions]) {
    if (seen.has(a.id)) {
      continue;
    }
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

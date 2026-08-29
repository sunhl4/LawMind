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
  const approvals = input.summary?.approvals;
  const matterActions = matterApprovalsToActions(approvals);
  const sid = input.currentSessionId?.trim();
  // 无会话绑定的行（案件审批/待审文书/交办）不灌入全工作区 chat 动作——
  // 动作池只含该行自身审批，避免「点 A 批 B」。
  const chatPool = sid
    ? [
        ...input.runActions,
        ...workspaceChatActions.filter((a) => a.sessionId === sid),
        ...(input.shellSessionId === sid ? input.sessionRequiresActions : []),
      ]
    : [];
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

/**
 * 绑定当前行要选中的动作：chat 动作按 run.actionId、案件审批按 run.approvalId。
 * 返回 null 表示该行没有可直接绑定的动作（调用方可回退到池内首个）。
 */
export function pickFleetActionForRun(
  actions: LawMindRequiresAction[],
  run: { actionId?: string; approvalId?: string } | null | undefined,
): LawMindRequiresAction | null {
  if (!run) {
    return null;
  }
  const actionId = run.actionId?.trim();
  if (actionId) {
    const hit = actions.find((a) => a.id === actionId);
    if (hit) {
      return hit;
    }
  }
  const approvalId = run.approvalId?.trim();
  if (approvalId) {
    const hit = actions.find(
      (a) => a.kind === "matter_approval" && (a.approvalId?.trim() || a.id) === approvalId,
    );
    if (hit) {
      return hit;
    }
  }
  return null;
}

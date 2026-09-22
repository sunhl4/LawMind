/**
 * 在办队列三路聚合（外发 / 澄清 + 可选待审文书 + 交办待发信）。
 */
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import type { ActionSummaryPayload } from "./lawmind-requires-action";
import { fleetRunNeedsLawyer as needsLawyer } from "./lawmind-fleet-queue";

export function mergeFleetQueueRows(opts: {
  fleetRuns: AgentRunSummary[] | undefined;
  pendingReviewDrafts: ActionSummaryPayload["pendingReviewDrafts"] | undefined;
  automationInbox: ActionSummaryPayload["automationInbox"] | undefined;
  snoozed: ReadonlySet<string>;
  /** 律师打开「签批审阅」后，待审稿回到待拍板。 */
  includePendingReview?: boolean;
}): AgentRunSummary[] {
  const { fleetRuns, pendingReviewDrafts, automationInbox, snoozed, includePendingReview } = opts;
  const runs = (fleetRuns ?? []).filter(
    (run) => needsLawyer(run) || (includePendingReview && run.kind === "pending_review"),
  );
  const seenTaskIds = new Set(
    runs.map((run) => run.taskId?.trim()).filter((id): id is string => Boolean(id)),
  );
  const fromDrafts: AgentRunSummary[] = includePendingReview
    ? (pendingReviewDrafts ?? []).flatMap((draft): AgentRunSummary[] => {
        const taskId = draft.taskId?.trim();
        if (!taskId || seenTaskIds.has(taskId)) {
          return [];
        }
        seenTaskIds.add(taskId);
        return [
          {
            id: `review:${taskId}`,
            kind: "pending_review",
            status: "awaiting_review",
            title: draft.title?.trim() || "待审核草稿",
            subtitle: draft.reviewStatus === "modified" ? "修改后待复核" : "交付物待审核",
            matterId: draft.matterId,
            taskId,
            updatedAt: draft.createdAt,
            createdAt: draft.createdAt,
            priority: 0,
          },
        ];
      })
    : [];
  const fromAutomations: AgentRunSummary[] = (automationInbox ?? [])
    .filter((item) => item.status === "open")
    .flatMap((item): AgentRunSummary[] => {
      if (item.pendingSend?.to) {
        const att = item.pendingSend.attachmentRelativePaths ?? [];
        const attNote = att.length
          ? `附件 ${att.map((p) => p.split("/").pop() || p).join("、")}`
          : "无附件";
        return [
          {
            id: `automation-send:${item.id}`,
            kind: "automation_send",
            status: "awaiting_approval",
            title: item.title?.trim() || "交办待发信",
            subtitle: `${item.pendingSend.to} · ${item.pendingSend.subject} · ${attNote}`,
            matterId: item.matterId,
            taskId: item.draftTaskId,
            queueItemId: item.id,
            jobId: item.jobId,
            updatedAt: item.createdAt,
            createdAt: item.createdAt,
            priority: 1,
          },
        ];
      }
      return [];
    });
  const merged = [...runs, ...fromDrafts, ...fromAutomations];
  return snoozed.size === 0 ? merged : merged.filter((r) => !snoozed.has(r.id));
}

import type { ReactNode } from "react";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { ArtifactDraft, TaskRecord } from "../../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import { type AcceptanceSummaryItem } from "./matter-acceptance-display";
import { MatterTaskBoard } from "./MatterTaskBoard";
import type { TaskBoardJobInput } from "./matter-task-board";
import { LawmindApprovalQueue } from "../LawmindApprovalQueue";
import { MatterRoleBoard, type RoleAssignmentRow } from "./MatterRoleBoard";
import { useMemo } from "react";

type ReviewOpenArgs = {
  taskId: string;
  matterId?: string;
  statusFilter?: ArtifactDraft["reviewStatus"] | "all";
  listMode?: "pending" | "all";
};

type Props = {
  apiBase: string;
  matterId: string | null;
  tasks: TaskRecord[];
  drafts: ArtifactDraft[];
  queueItems?: WorkQueueItem[];
  approvalRequests?: ApprovalRequest[];
  acceptanceByTask: Record<string, AcceptanceSummaryItem | undefined>;
  draftCitationByTask?: Record<string, DraftCitationIntegrityView | undefined>;
  onOpenReview?: (args: ReviewOpenArgs) => void;
  onOpenWorkflowLibrary?: () => void;
  onOpenChatSession?: (sessionId: string, matterId?: string) => void;
  onOpenNeedsDecision?: () => void;
  jobs?: TaskBoardJobInput[];
};

export function MatterTasksPanel(props: Props): ReactNode {
  const {
    apiBase,
    matterId,
    tasks,
    drafts,
    queueItems = [],
    approvalRequests = [],
    acceptanceByTask,
    onOpenReview,
    onOpenWorkflowLibrary,
    onOpenChatSession,
    onOpenNeedsDecision,
    jobs = [],
  } = props;

  const roleRows: RoleAssignmentRow[] = useMemo(() => {
    const byAssistant = new Map<string, RoleAssignmentRow>();
    for (const t of tasks) {
      const aid = (t as { assistantId?: string }).assistantId?.trim() || "default";
      if (!byAssistant.has(aid)) {
        byAssistant.set(aid, {
          assistantId: aid,
          displayName: aid,
          pendingApprovalCount: 0,
        });
      }
    }
    for (const a of approvalRequests) {
      if (a.status !== "pending") {
        continue;
      }
      const aid = a.requestedBy?.trim() || a.targetRole?.trim() || "approver";
      const row = byAssistant.get(aid) ?? {
        assistantId: aid,
        displayName: a.targetRole ?? aid,
        roleDisplayName: a.targetRole,
        pendingApprovalCount: 0,
      };
      row.pendingApprovalCount = (row.pendingApprovalCount ?? 0) + 1;
      byAssistant.set(aid, row);
    }
    return [...byAssistant.values()];
  }, [approvalRequests, tasks]);

  return (
    <div className="lm-workbench-panel">
      <h3>任务与待办</h3>
      <p className="lm-meta">
        汇总任务进度、工作队列、待审批与草稿验收状态；优先处理标为待审批与待复核项。
      </p>
      <LawmindApprovalQueue
        apiBase={apiBase}
        matterId={matterId}
        onOpenSession={onOpenChatSession}
        onOpenReview={
          onOpenReview
            ? (taskId, mid) =>
                onOpenReview({ taskId, matterId: mid ?? matterId ?? undefined })
            : undefined
        }
        compact
      />
      {matterId ? <MatterRoleBoard matterId={matterId} rows={roleRows} /> : null}
      <MatterTaskBoard
        matterId={matterId}
        tasks={tasks}
        queueItems={queueItems}
        approvalRequests={approvalRequests}
        drafts={drafts}
        acceptanceByTask={acceptanceByTask}
        onOpenReview={onOpenReview}
        onOpenWorkflowLibrary={onOpenWorkflowLibrary}
        onOpenNeedsDecision={onOpenNeedsDecision}
        jobs={jobs}
      />
    </div>
  );
}

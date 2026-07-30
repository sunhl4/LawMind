import type { ReactNode } from "react";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { ArtifactDraft, TaskRecord } from "../../../../../src/lawmind/types.ts";
import type { AcceptanceSummaryItem } from "./matter-acceptance-display";
import { DraftAcceptanceBadge } from "./matter-acceptance-display";
import { mergeTaskBoardRows, type TaskBoardJobInput } from "./matter-task-board";

type ReviewOpenArgs = {
  taskId: string;
  matterId?: string;
};

type Props = {
  matterId?: string | null;
  tasks: TaskRecord[];
  queueItems: WorkQueueItem[];
  approvalRequests: ApprovalRequest[];
  drafts: ArtifactDraft[];
  jobs?: TaskBoardJobInput[];
  acceptanceByTask: Record<string, AcceptanceSummaryItem | undefined>;
  onOpenReview?: (args: ReviewOpenArgs) => void;
  onOpenWorkflowLibrary?: () => void;
  onOpenNeedsDecision?: () => void;
};

export function MatterTaskBoard(props: Props): ReactNode {
  const {
    matterId,
    tasks,
    queueItems,
    approvalRequests,
    drafts,
    jobs = [],
    acceptanceByTask,
    onOpenReview,
    onOpenWorkflowLibrary,
    onOpenNeedsDecision,
  } = props;

  const rows = mergeTaskBoardRows({ tasks, queueItems, approvalRequests, drafts, jobs });

  if (rows.length === 0) {
    return (
      <div className="lm-task-board-empty">
        <p className="lm-meta">暂无进行中的任务、待办或审批。</p>
        {onOpenWorkflowLibrary ? (
          <button type="button" className="lm-btn lm-btn-sm" onClick={onOpenWorkflowLibrary}>
            按流程办
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="lm-task-board-list">
      {rows.map((row) => (
        <li key={row.id} className={`lm-task-board-row lm-task-board-row-${row.kind}`}>
          <div className="lm-task-board-row-head">
            <span className="lm-task-board-kind">{row.subtitle}</span>
            <strong>{row.title}</strong>
            <em className="lm-task-board-status">{row.statusLabel}</em>
          </div>
          {row.kind === "draft" && row.draftTaskId ? (
            <div className="lm-task-board-row-actions">
              <DraftAcceptanceBadge acc={acceptanceByTask[row.draftTaskId]} />
              {onOpenReview ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  onClick={() =>
                    onOpenReview({
                      taskId: row.draftTaskId!,
                      matterId: matterId ?? undefined,
                    })
                  }
                >
                  进入文书台
                </button>
              ) : null}
            </div>
          ) : null}
          {row.kind === "approval" && onOpenNeedsDecision ? (
            <div className="lm-task-board-row-actions">
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                onClick={() => onOpenNeedsDecision()}
              >
                去拍板
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import { DraftCitationBadge } from "./matter-draft-citation-badge";
import {
  approvalStatusLabel,
  priorityLabel,
  queueKindLabel,
  reviewStatusLabel,
} from "./matter-display-labels.js";
import { lawyerRiskLevelLabel } from "../lawmind-lawyer-labels";

type ReviewOpen = (
  taskId: string,
  opts?: {
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
    sourceSurface?: string;
    sourceLabel?: string;
  },
) => void;

type Props = {
  filteredQueueItems: WorkQueueItem[];
  filteredApprovalRequests: ApprovalRequest[];
  filteredDrafts: ArtifactDraft[];
  draftCitationByTask: Record<string, DraftCitationIntegrityView>;
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  openReviewFromMatter: ReviewOpen;
};

export function MatterOverviewTodoCards(props: Props): ReactNode {
  const {
    filteredQueueItems,
    filteredApprovalRequests,
    filteredDrafts,
    draftCitationByTask,
    onOpenReview,
    openReviewFromMatter,
  } = props;

  return (
    <div className="lm-matter-cockpit-grid">
      {filteredQueueItems.length > 0 ? (
        <section className="lm-matter-cockpit-card">
          <h3>工作队列</h3>
          <ul className="lm-matter-ops-list">
            {filteredQueueItems.slice(0, 8).map((item) => (
              <li key={item.queueItemId}>
                <div className="lm-matter-ops-title">
                  <span>{item.title}</span>
                  <div className="lm-matter-ops-actions">
                    <span className={`lm-matter-pill lm-matter-pill-priority-${item.priority}`}>
                      {priorityLabel(item.priority)}
                    </span>
                    {onOpenReview && item.relatedTaskId ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        onClick={() =>
                          openReviewFromMatter(item.relatedTaskId!, {
                            statusFilter: item.kind === "ready_to_render" ? "approved" : "pending",
                            listMode: item.kind === "ready_to_render" ? "all" : "pending",
                            sourceSurface: "queue",
                            sourceLabel: item.title,
                          })
                        }
                      >
                        改稿
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="lm-matter-ops-meta">
                  {queueKindLabel(item.kind)}
                  {item.detail ? ` · ${item.detail}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {filteredApprovalRequests.length > 0 ? (
        <section className="lm-matter-cockpit-card">
          <h3>审批节点</h3>
          <ul className="lm-matter-ops-list">
            {filteredApprovalRequests.slice(0, 8).map((item) => (
              <li key={item.approvalId}>
                <div className="lm-matter-ops-title">
                  <span>{approvalStatusLabel(item.status)}</span>
                  <div className="lm-matter-ops-actions">
                    <span className={`lm-matter-pill lm-matter-pill-status-${item.status}`}>
                      {lawyerRiskLevelLabel(item.riskLevel) ?? item.riskLevel}
                    </span>
                    {onOpenReview && item.deliverableId ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        onClick={() =>
                          openReviewFromMatter(item.deliverableId!, {
                            statusFilter:
                              item.status === "approved"
                                ? "approved"
                                : item.status === "needs_changes"
                                  ? "modified"
                                  : "all",
                            listMode: item.status === "pending" ? "pending" : "all",
                            sourceSurface: "approval",
                            sourceLabel: item.reason,
                          })
                        }
                      >
                        改稿
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="lm-matter-ops-meta">{item.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {filteredDrafts.length > 0 ? (
        <section className="lm-matter-cockpit-card">
          <h3>交付物状态</h3>
          <ul className="lm-matter-ops-list">
            {filteredDrafts.slice(0, 8).map((draft) => (
              <li key={draft.taskId}>
                <div className="lm-matter-ops-title">
                  <span>{draft.title}</span>
                  <div className="lm-matter-ops-actions">
                    <span className={`lm-matter-pill lm-matter-pill-status-${draft.reviewStatus}`}>
                      {reviewStatusLabel(draft.reviewStatus)}
                    </span>
                    {onOpenReview ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        onClick={() =>
                          openReviewFromMatter(draft.taskId, {
                            matterId: draft.matterId,
                            statusFilter: draft.reviewStatus,
                            listMode: draft.reviewStatus === "pending" ? "pending" : "all",
                            sourceSurface: "draft-status",
                            sourceLabel: draft.title,
                          })
                        }
                      >
                        改稿
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="lm-matter-ops-meta">
                  {draft.templateId}
                  <DraftCitationBadge cit={draftCitationByTask[draft.taskId]} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

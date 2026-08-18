/**
 * <MatterReviewQueuePanel /> — 工作队列 + 待审批，可跳审核台。
 *
 * 接 queue-service / approval-service 的列表数据；本组件不发起 fetch。
 */

import type { ReactNode } from "react";

export type ReviewQueueRow = {
  queueItemId: string;
  title: string;
  kind: string;
  kindLabel?: string;
  priority: "critical" | "high" | "normal" | "low";
  priorityLabel?: string;
  status: string;
  updatedAt?: string;
  relatedTaskId?: string;
  detail?: string;
};

export type ApprovalRow = {
  approvalId: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "needs_changes";
  statusLabel?: string;
  riskLevel: "low" | "medium" | "high";
  targetRole?: string;
  requestedAt?: string;
  deliverableId?: string;
};

type Props = {
  matterId: string;
  queueItems: ReviewQueueRow[];
  approvals: ApprovalRow[];
  onOpenQueueReview?: (item: ReviewQueueRow) => void;
  onOpenApprovalReview?: (item: ApprovalRow) => void;
};

export function MatterReviewQueuePanel({
  matterId,
  queueItems,
  approvals,
  onOpenQueueReview,
  onOpenApprovalReview,
}: Props): ReactNode {
  return (
    <>
      <section
        className="lm-matter-cockpit-card"
        data-testid="lm-matter-review-queue"
        data-matter-id={matterId}
      >
        <h3>工作队列</h3>
        {queueItems.length === 0 ? (
          <p className="lm-meta">无</p>
        ) : (
          <ul className="lm-matter-ops-list">
            {queueItems.map((q) => (
              <li key={q.queueItemId}>
                <div className="lm-matter-ops-title">
                  <span>{q.title}</span>
                  <div className="lm-matter-ops-actions">
                    <span className={`lm-matter-pill lm-matter-pill-priority-${q.priority}`}>
                      {q.priorityLabel ?? q.priority}
                    </span>
                    {onOpenQueueReview && q.relatedTaskId ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        onClick={() => onOpenQueueReview(q)}
                      >
                        去审核
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="lm-matter-ops-meta">
                  {q.kindLabel ?? q.kind}
                  {q.detail ? ` · ${q.detail}` : ""}
                  {q.updatedAt ? ` · 更新于 ${q.updatedAt}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lm-matter-cockpit-card" data-testid="lm-matter-review-approvals">
        <h3>审批节点</h3>
        {approvals.length === 0 ? (
          <p className="lm-meta">无</p>
        ) : (
          <ul className="lm-matter-ops-list">
            {approvals.map((a) => (
              <li key={a.approvalId}>
                <div className="lm-matter-ops-title">
                  <span>{a.statusLabel ?? a.reason}</span>
                  <div className="lm-matter-ops-actions">
                    <span className={`lm-matter-pill lm-matter-pill-status-${a.status}`}>
                      {a.riskLevel.toUpperCase()}
                    </span>
                    {onOpenApprovalReview && a.deliverableId ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        onClick={() => onOpenApprovalReview(a)}
                      >
                        去审核
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="lm-matter-ops-meta">
                  {a.reason}
                  {a.targetRole ? ` · 目标 Role ${a.targetRole}` : ""}
                  {a.requestedAt ? ` · 请求于 ${a.requestedAt}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default MatterReviewQueuePanel;

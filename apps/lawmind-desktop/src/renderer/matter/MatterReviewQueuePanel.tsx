/**
 * <MatterReviewQueuePanel /> — W11 视图组件 2/6（队列 + 待审批）。
 *
 * 接 src/lawmind/application/services/queue-service 与 approval-service 的
 * 列表数据；本组件不发起 fetch，只渲染传入的 view models。
 */

import type { ReactNode } from "react";

export type ReviewQueueRow = {
  queueItemId: string;
  title: string;
  kind: string;
  priority: "critical" | "high" | "normal" | "low";
  status: string;
  updatedAt?: string;
};

export type ApprovalRow = {
  approvalId: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "needs_changes";
  riskLevel: "low" | "medium" | "high";
  targetRole?: string;
  requestedAt?: string;
};

type Props = {
  matterId: string;
  queueItems: ReviewQueueRow[];
  approvals: ApprovalRow[];
};

export function MatterReviewQueuePanel({ matterId, queueItems, approvals }: Props): ReactNode {
  return (
    <section
      className="lm-matter-review-queue"
      data-testid="lm-matter-review-queue"
      data-matter-id={matterId}
    >
      <h3>待办队列</h3>
      {queueItems.length === 0 ? (
        <div className="lm-callout lm-callout-muted">该案件没有未完成队列。</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {queueItems.map((q) => (
            <li
              key={q.queueItemId}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid var(--lm-border, #e5e7eb)",
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {q.title}{" "}
                <span className="lm-meta">
                  ({q.kind} · {q.priority})
                </span>
              </div>
              <div className="lm-meta">
                状态 {q.status}
                {q.updatedAt ? ` · 更新于 ${q.updatedAt}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ marginTop: 24 }}>待审批</h3>
      {approvals.length === 0 ? (
        <div className="lm-callout lm-callout-muted">该案件当前没有待审批项。</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {approvals.map((a) => (
            <li
              key={a.approvalId}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid var(--lm-border, #e5e7eb)",
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {a.reason} <span className="lm-meta">({a.riskLevel})</span>
              </div>
              <div className="lm-meta">
                状态 {a.status}
                {a.targetRole ? ` · 目标 Role ${a.targetRole}` : ""}
                {a.requestedAt ? ` · 请求于 ${a.requestedAt}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default MatterReviewQueuePanel;

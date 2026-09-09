import { useState, type ReactNode } from "react";
import type { DelegationRow } from "./lawmind-app-data";
import {
  delegationStatusBadgeClass,
  delegationStatusLabel,
  delegationSummaryLine,
  isActiveDelegation,
} from "./lawmind-delegation-status";
import { confirmDialog } from "./lawmind-confirm-dialog";

type Props = {
  delegations: DelegationRow[];
  assistantDisplayById?: Record<string, string>;
  formatRelativeTime: (iso: string) => string;
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  onCancelDelegation?: (delegation: DelegationRow) => void | Promise<void>;
  cancelBusyId?: string | null;
  onShowMore?: () => void;
};

function assistantLabel(
  id: string,
  assistantDisplayById?: Record<string, string>,
): string {
  return assistantDisplayById?.[id] ?? id;
}

function statusHint(d: DelegationRow): string | null {
  switch (d.status) {
    case "pending":
      return "对方尚未开始处理。若久等无回应，可撤销后改派他人。";
    case "running":
      return "对方正在处理中。可打开会话查看进展或补充说明。";
    case "completed":
      return "对方已交回结果，可打开会话查看完整内容。";
    case "completed_after_timeout":
      return "本次交办曾判超时，但对方后来仍交回了结果，可打开会话查看。";
    case "failed":
    case "timeout":
      return "本次交办未成功完成，可打开会话了解情况后重新交办。";
    case "cancelled":
      return "已撤销，不再继续处理。";
    default:
      return null;
  }
}

export function LawmindCollabDelegationCards(props: Props): ReactNode {
  const {
    delegations,
    assistantDisplayById,
    formatRelativeTime,
    onOpenDelegationTargetChat,
    onCancelDelegation,
    cancelBusyId,
    onShowMore,
  } = props;

  const [detailId, setDetailId] = useState<string | null>(null);

  const active = delegations.filter(isActiveDelegation);
  const done = delegations.filter((d) => !isActiveDelegation(d));

  const renderList = (rows: DelegationRow[], empty: string) => {
    if (rows.length === 0) {
      return <p className="lm-meta lm-collab-card-empty">{empty}</p>;
    }
    return (
      <ul className="lm-list lm-collab-card-list">
        {rows.slice(0, 8).map((d) => {
          const expanded = detailId === d.delegationId;
          const toName = assistantLabel(d.toAssistant, assistantDisplayById);
          const fromName = assistantLabel(d.fromAssistant, assistantDisplayById);
          const hint = statusHint(d);
          const openLabel =
            d.status === "completed" ||
            d.status === "completed_after_timeout" ||
            d.status === "failed" ||
            d.status === "timeout"
              ? "查看结果"
              : "查看进展";
          return (
            <li key={d.delegationId} className="lm-collab-card-row">
              <div className="lm-list-row">
                <span className={delegationStatusBadgeClass(d.status)}>{delegationStatusLabel(d.status)}</span>
                <span className="lm-list-title">{delegationSummaryLine(d, assistantDisplayById)}</span>
              </div>
              <div className="lm-list-time">{formatRelativeTime(d.completedAt ?? d.startedAt)}</div>
              <div className="lm-collab-card-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  onClick={() => setDetailId(expanded ? null : d.delegationId)}
                >
                  {expanded ? "收起" : "说明"}
                </button>
                {onOpenDelegationTargetChat ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    onClick={() => void onOpenDelegationTargetChat(d)}
                  >
                    {openLabel}
                  </button>
                ) : null}
                {onCancelDelegation && isActiveDelegation(d) ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={cancelBusyId === d.delegationId}
                    onClick={() => {
                      const preview = d.task.trim().slice(0, 40);
                      void (async () => {
                        const ok = await confirmDialog({
                          title: `确定撤销交办「${preview}${d.task.trim().length > 40 ? "…" : ""}」？`,
                          confirmLabel: "撤销",
                        });
                        if (ok) {
                          await onCancelDelegation(d);
                        }
                      })();
                    }}
                  >
                    {cancelBusyId === d.delegationId ? "撤销中…" : "撤销"}
                  </button>
                ) : null}
              </div>
              {expanded ? (
                <div className="lm-collab-delegation-detail">
                  <div className="lm-collab-delegation-detail-block">
                    <div className="lm-collab-delegation-detail-label">交办事项</div>
                    <p className="lm-collab-delegation-detail-body">{d.task.trim() || "（无文字说明）"}</p>
                  </div>
                  <div className="lm-collab-delegation-detail-meta">
                    <span>承办：{toName}</span>
                    <span>发起：{fromName}</span>
                    {d.matterId ? <span title={`案件编号 ${d.matterId}`}>已关联案件</span> : <span>未关联案件</span>}
                    <span>
                      {d.completedAt
                        ? `完成于 ${formatRelativeTime(d.completedAt)}`
                        : `交办于 ${formatRelativeTime(d.startedAt)}`}
                    </span>
                  </div>
                  {d.result?.trim() ? (
                    <div className="lm-collab-delegation-detail-block">
                      <div className="lm-collab-delegation-detail-label">对方回传</div>
                      <p className="lm-collab-delegation-detail-body">{d.result.trim()}</p>
                    </div>
                  ) : null}
                  {d.error?.trim() ? (
                    <div className="lm-collab-delegation-detail-block lm-collab-delegation-detail-error">
                      <div className="lm-collab-delegation-detail-label">未成功原因</div>
                      <p className="lm-collab-delegation-detail-body">{d.error.trim()}</p>
                    </div>
                  ) : null}
                  {hint ? <p className="lm-meta lm-collab-delegation-detail-hint">{hint}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="lm-collab-delegation-cards">
      <article className="lm-collab-card">
        <header className="lm-collab-card-header">
          <h3>进行中</h3>
          <span className="lm-section-count">{active.length}</span>
        </header>
        {renderList(active, "暂无进行中的交办")}
      </article>
      <article className="lm-collab-card">
        <header className="lm-collab-card-header">
          <h3>已完成</h3>
          <span className="lm-section-count">{done.length}</span>
        </header>
        {renderList(done, "暂无已完成的交办")}
      </article>
      {onShowMore ? (
        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm lm-collab-more-btn" onClick={onShowMore}>
          更多动态…
        </button>
      ) : null}
    </div>
  );
}

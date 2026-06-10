import type { ReactNode } from "react";
import type { DelegationRow } from "./lawmind-app-data";
import {
  delegationStatusBadgeClass,
  delegationStatusLabel,
  delegationSummaryLine,
  isActiveDelegation,
} from "./lawmind-delegation-status";

type Props = {
  delegations: DelegationRow[];
  assistantDisplayById?: Record<string, string>;
  formatRelativeTime: (iso: string) => string;
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  onShowMore?: () => void;
};

export function LawmindCollabDelegationCards(props: Props): ReactNode {
  const {
    delegations,
    assistantDisplayById,
    formatRelativeTime,
    onOpenDelegationTargetChat,
    onShowMore,
  } = props;

  const active = delegations.filter(isActiveDelegation);
  const done = delegations.filter((d) => !isActiveDelegation(d));

  const renderList = (rows: DelegationRow[], empty: string) => {
    if (rows.length === 0) {
      return <p className="lm-meta lm-collab-card-empty">{empty}</p>;
    }
    return (
      <ul className="lm-list lm-collab-card-list">
        {rows.slice(0, 8).map((d) => (
          <li key={d.delegationId} className="lm-collab-card-row">
            <div className="lm-list-row">
              <span className={delegationStatusBadgeClass(d.status)}>{delegationStatusLabel(d.status)}</span>
              <span className="lm-list-title">{delegationSummaryLine(d, assistantDisplayById)}</span>
            </div>
            <div className="lm-list-time">{formatRelativeTime(d.completedAt ?? d.startedAt)}</div>
            {onOpenDelegationTargetChat ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                onClick={() => void onOpenDelegationTargetChat(d)}
              >
                {d.status === "completed" ? "查看结果" : "打开会话"}
              </button>
            ) : null}
          </li>
        ))}
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
        {renderList(active, "暂无进行中的委派")}
      </article>
      <article className="lm-collab-card">
        <header className="lm-collab-card-header">
          <h3>已完成</h3>
          <span className="lm-section-count">{done.length}</span>
        </header>
        {renderList(done, "暂无已结束的委派")}
      </article>
      {onShowMore ? (
        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm lm-collab-more-btn" onClick={onShowMore}>
          委派动态与门禁历史…
        </button>
      ) : null}
    </div>
  );
}

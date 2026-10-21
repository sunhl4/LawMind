/**
 * 工具/案件操作确认浮层（不是「待我拍板」）。
 * 「待我拍板」只在侧栏，进入在办。本面板只处理 /api/approvals 里的操作确认。
 */

import { formatToolArgsDiffPreview } from "../../../../src/lawmind/platform/tool-approval-diff";
import type { ReactNode } from "react";
import { confirmDialog } from "./lawmind-confirm-dialog";
import { useApprovalRequests } from "./useApprovalRequests";
import type { ApprovalItem } from "./stores/approval-request-store";

function formatRiskLabel(level: ApprovalItem["riskLevel"]): string {
  if (level === "high") {
    return "高风险";
  }
  if (level === "medium") {
    return "中风险";
  }
  return "低风险";
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function summarizeApprovalArgs(item: ApprovalItem): string {
  const lines = formatToolArgsDiffPreview(item.toolArgs);
  return lines.length > 0 ? lines.slice(0, 6).map((line) => `${line.key}：${line.value}`).join("；") : "无附加参数";
}

function ApprovalRow({
  item,
  busy,
  onApprove,
  onReject,
  onMoreInfo,
}: {
  item: ApprovalItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onMoreInfo: () => void;
}): ReactNode {
  return (
    <li className="lm-approval-item">
      <div className="lm-approval-item-head">
        <strong className="lm-approval-item-title">{item.title}</strong>
        <span className={`lm-approval-risk lm-approval-risk-${item.riskLevel}`}>
          {formatRiskLabel(item.riskLevel)}
        </span>
      </div>
      <p className="lm-meta lm-approval-summary">{item.summary}</p>
      {item.toolName ? (
        <p className="lm-meta lm-approval-args" data-testid="lm-approval-args">
          {summarizeApprovalArgs(item)}
        </p>
      ) : null}
      <p className="lm-meta lm-approval-expiry">
        请于 {formatDateTime(item.expiresAt)} 前处理
      </p>
      <div className="lm-approval-actions">
        <button
          type="button"
          className="lm-btn lm-btn-ghost"
          disabled={busy}
          onClick={onMoreInfo}
          title="先关闭面板，回到对话补充信息"
        >
          需要更多信息
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-danger"
          disabled={busy}
          onClick={onReject}
        >
          拒绝
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-primary"
          disabled={busy}
          onClick={onApprove}
        >
          签批
        </button>
      </div>
    </li>
  );
}

export type LawmindApprovalRequestHostProps = {
  apiBase: string | undefined;
  matterId?: string | null;
};

export function LawmindApprovalRequestHost({
  apiBase,
  matterId,
}: LawmindApprovalRequestHostProps): ReactNode {
  const {
    items,
    loading,
    error,
    open,
    setOpen,
    approve,
    reject,
    requestMoreInfo,
    count,
  } = useApprovalRequests(apiBase, matterId);

  if (!apiBase || count === 0) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="lm-approval-float"
        aria-label="待确认"
        onClick={() => setOpen(true)}
        data-testid="lm-approval-float"
      >
        待确认 ({count})
      </button>
      {open ? (
        <div
          className="lm-approval-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
          data-testid="lm-approval-backdrop"
        >
          <aside
            className="lm-approval-panel"
            role="dialog"
            aria-label="待确认"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="lm-approval-panel-head">
              <h3>待确认</h3>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-small"
                onClick={() => setOpen(false)}
              >
                关闭
              </button>
            </header>
            {error ? (
              <p className="lm-approval-error" role="alert">
                {error}
              </p>
            ) : null}
            {loading && items.length === 0 ? (
              <p className="lm-meta" aria-busy="true">
                加载中…
              </p>
            ) : null}
            <ul className="lm-approval-list">
              {items.length === 0 ? (
                <li className="lm-meta">暂无待确认操作</li>
              ) : (
                items.map((item) => (
                  <ApprovalRow
                    key={item.id}
                    item={item}
                    busy={loading}
                    onApprove={() => {
                      void (async () => {
                        const ok = await confirmDialog({
                          title: "签批此操作？",
                          body: item.summary,
                          confirmLabel: "签批",
                        });
                        if (ok) {
                          await approve(item);
                        }
                      })();
                    }}
                    onReject={() => {
                      void (async () => {
                        const ok = await confirmDialog({
                          title: "拒绝此操作？",
                          body: item.summary,
                          confirmLabel: "拒绝",
                          tone: "danger",
                        });
                        if (ok) {
                          await reject(item);
                        }
                      })();
                    }}
                    onMoreInfo={() => {
                      requestMoreInfo();
                    }}
                  />
                ))
              )}
            </ul>
          </aside>
        </div>
      ) : null}
    </>
  );
}

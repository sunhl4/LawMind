/**
 * ProWorkBench-style centralized approval queue (matter + tool approvals).
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ApprovalRequest } from "../../../../src/lawmind/core/contracts.ts";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { ApiRequestError, apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { toolDisplayNameZh } from "../../../../src/lawmind/platform/requires-action.js";
import { confirmDialog } from "./lawmind-confirm-dialog";
import { useRequireSignoffReview } from "./lawmind-review-prefs";

export type ToolApprovalRow = {
  actionId: string;
  sessionId: string;
  matterId?: string;
  toolName?: string;
  title: string;
  summary: string;
  toolArgs?: Record<string, unknown>;
  createdAt: string;
};

type PendingReviewDraft = {
  taskId: string;
  matterId?: string;
  title: string;
  reviewStatus: "pending" | "modified";
  createdAt: string;
};

type SummaryResponse = {
  ok?: boolean;
  approvals?: ApprovalRequest[];
  toolApprovals?: ToolApprovalRow[];
  pendingToolApprovals?: number;
  pendingReviewDrafts?: PendingReviewDraft[];
};

type Props = {
  apiBase: string;
  matterId?: string | null;
  /** 打开对应对话以处理工具批准 */
  onOpenSession?: (sessionId: string, matterId?: string) => void;
  /** 打开文书台签批指定草稿 */
  onOpenReview?: (taskId: string, matterId?: string) => void;
  compact?: boolean;
};

function isAlreadyResolved(e: unknown): boolean {
  return (
    e instanceof ApiRequestError &&
    e.status === 409 &&
    e.body?.code === "approval_already_resolved"
  );
}

function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) {
    return "无附加参数";
  }
  const keys = Object.keys(args).filter((k) => k !== "__approved");
  if (keys.length === 0) {
    return "无附加参数";
  }
  return keys.map((k) => `${k}：…`).join("；");
}

export function LawmindApprovalQueue(props: Props): ReactNode {
  const { apiBase, matterId, onOpenSession, onOpenReview, compact = false } = props;
  const requireSignoffReview = useRequireSignoffReview();
  const [rows, setRows] = useState<ToolApprovalRow[]>([]);
  const [matterApprovals, setMatterApprovals] = useState<ApprovalRequest[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<PendingReviewDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const t = matterId?.trim() ?? "";
      const q = t && isValidMatterId(t) ? `?matterId=${encodeURIComponent(t)}` : "";
      const s = await apiGetJson<SummaryResponse>(apiBase, `/api/action-summary${q}`);
      setRows(s.toolApprovals ?? []);
      setMatterApprovals((s.approvals ?? []).filter((a) => a.status === "pending"));
      setReviewDrafts(s.pendingReviewDrafts ?? []);
    } catch (e) {
      setError(errorMessage(e, "无法加载待确认"));
    } finally {
      setLoading(false);
    }
  }, [apiBase, matterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleReviewDrafts = requireSignoffReview ? reviewDrafts : [];
  const empty = rows.length === 0 && matterApprovals.length === 0 && visibleReviewDrafts.length === 0;

  return (
    <section
      className={`lm-approval-queue${compact ? " lm-approval-queue-compact" : ""}`}
      aria-label="本案待确认"
    >
      <div className="lm-approval-queue-head">
        <h4>本案待确认</h4>
        <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={() => void refresh()}>
          刷新
        </button>
      </div>
      {loading ? <p className="lm-meta" aria-busy="true">加载中…</p> : null}
      {error ? <p className="lm-meta lm-callout-warn">{error}</p> : null}
      {empty && !loading ? (
        <p className="lm-meta">暂无待确认操作。</p>
      ) : null}

      {visibleReviewDrafts.length > 0 ? (
        <div className="lm-approval-queue-block">
          <h5 className="lm-meta">待审文书</h5>
          <ul className="lm-approval-queue-list">
            {visibleReviewDrafts.map((d) => (
              <li key={d.taskId} className="lm-approval-queue-row">
                <div className="lm-approval-queue-row-head">
                  <strong>{d.title?.trim() || d.taskId}</strong>
                  <span className="lm-pill lm-pill-warn">
                    {d.reviewStatus === "modified" ? "已修订" : "待审核"}
                  </span>
                </div>
                {onOpenReview ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    onClick={() => onOpenReview(d.taskId, d.matterId)}
                  >
                    改稿
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="lm-approval-queue-block">
          <h5 className="lm-meta">需确认的操作</h5>
          <ul className="lm-approval-queue-list">
            {rows.map((r) => (
              <li key={`${r.sessionId}:${r.actionId}`} className="lm-approval-queue-row">
                <div className="lm-approval-queue-row-head">
                  <strong>
                    {r.toolName ? toolDisplayNameZh(r.toolName) : r.title}
                  </strong>
                  <span className="lm-pill lm-pill-warn">需批准</span>
                </div>
                <p className="lm-meta">{r.summary}</p>
                <p className="lm-meta lm-approval-queue-args">{summarizeArgs(r.toolArgs)}</p>
                {r.matterId ? (
                  <span className="lm-meta">案件 {r.matterId}</span>
                ) : null}
                {onOpenSession ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    onClick={() => onOpenSession(r.sessionId, r.matterId)}
                  >
                    在对话中处理
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {matterApprovals.length > 0 ? (
        <div className="lm-approval-queue-block">
          <h5 className="lm-meta">案件审批</h5>
          <ul className="lm-approval-queue-list">
            {matterApprovals.map((a) => (
              <li key={a.approvalId} className="lm-approval-queue-row">
                <strong>{a.reason.slice(0, 80)}</strong>
                <span className="lm-meta">
                  {a.targetRole ? `→ ${a.targetRole}` : ""} · {a.riskLevel ?? "normal"}
                </span>
                <div className="lm-approval-queue-row-actions">
                  {a.deliverableId && onOpenReview ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-sm"
                      onClick={() => onOpenReview(a.deliverableId ?? "", a.matterId)}
                    >
                      去在办
                    </button>
                  ) : onOpenReview ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-sm"
                      onClick={() => onOpenReview("", a.matterId)}
                    >
                      去在办
                    </button>
                  ) : onOpenSession ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-sm"
                      onClick={() => onOpenSession("", a.matterId)}
                    >
                      去对话处理
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="lm-btn lm-btn-accent lm-btn-sm"
                    disabled={resolvingId === a.approvalId}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirmDialog({
                          title: "通过此审批？",
                          body: a.reason,
                          confirmLabel: "通过",
                        });
                        if (!ok) {
                          return;
                        }
                        setResolvingId(a.approvalId);
                        setError(null);
                        try {
                          await apiSendJson(
                            apiBase,
                            `/api/approvals/${encodeURIComponent(a.approvalId)}/approve`,
                            "POST",
                          );
                          await refresh();
                        } catch (e) {
                          if (isAlreadyResolved(e)) {
                            await refresh();
                            return;
                          }
                          setError(errorMessage(e, "通过失败"));
                        } finally {
                          setResolvingId(null);
                        }
                      })();
                    }}
                  >
                    通过
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    disabled={resolvingId === a.approvalId}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirmDialog({
                          title: "驳回此审批？",
                          body: a.reason,
                          confirmLabel: "驳回",
                          tone: "danger",
                        });
                        if (!ok) {
                          return;
                        }
                        setResolvingId(a.approvalId);
                        setError(null);
                        try {
                          await apiSendJson(
                            apiBase,
                            `/api/approvals/${encodeURIComponent(a.approvalId)}/reject`,
                            "POST",
                          );
                          await refresh();
                        } catch (e) {
                          if (isAlreadyResolved(e)) {
                            await refresh();
                            return;
                          }
                          setError(errorMessage(e, "驳回失败"));
                        } finally {
                          setResolvingId(null);
                        }
                      })();
                    }}
                  >
                    驳回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

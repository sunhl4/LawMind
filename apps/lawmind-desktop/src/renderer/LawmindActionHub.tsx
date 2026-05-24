import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ApprovalRequest } from "../../../../src/lawmind/core/contracts.ts";
import {
  loadActionSummary,
  resolveMatterApproval,
  resumeChatAction,
  buildClarificationAnswerMap,
  type LawMindRequiresAction,
  type ActionSummaryPayload,
} from "./lawmind-requires-action";
import { errorMessage } from "./api-client";
import { LawmindRequiresActionCard } from "./LawmindRequiresActionCard";

type Props = {
  apiBase: string;
  matterId?: string | null;
  open: boolean;
  onClose: () => void;
  onRefreshSummary?: () => void;
  /** 会话级待处理（来自当前聊天 session） */
  sessionRequiresActions?: LawMindRequiresAction[];
  sessionId?: string;
  onChatResumeComplete?: () => void | Promise<void>;
};

export function LawmindActionHub(props: Props): ReactNode {
  const {
    apiBase,
    matterId,
    open,
    onClose,
    onRefreshSummary,
    sessionRequiresActions = [],
    sessionId,
    onChatResumeComplete,
  } = props;

  const [summary, setSummary] = useState<ActionSummaryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarificationDraft, setClarificationDraft] = useState<Record<string, string>>({});
  const [hubTab, setHubTab] = useState<"chat" | "matter" | "queue">("chat");

  const refresh = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await loadActionSummary(apiBase, matterId ?? undefined);
      setSummary(s);
      onRefreshSummary?.();
    } catch (e) {
      setError(errorMessage(e, "无法加载待办摘要"));
    } finally {
      setLoading(false);
    }
  }, [apiBase, matterId, onRefreshSummary]);

  useEffect(() => {
    if (open) {
      setHubTab("chat");
      void refresh();
    }
  }, [open, refresh]);

  const handleApproveTool = async (action: LawMindRequiresAction) => {
    if (!sessionId) {
      setError("请先在本对话中处理，或打开对应会话。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resumeChatAction(apiBase, {
        sessionId,
        actionId: action.id,
        decision: "approve",
      });
      await onChatResumeComplete?.();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "批准失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleRejectTool = async (action: LawMindRequiresAction) => {
    if (!sessionId) {
      return;
    }
    setBusy(true);
    try {
      await resumeChatAction(apiBase, {
        sessionId,
        actionId: action.id,
        decision: "reject",
      });
      await onChatResumeComplete?.();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "操作失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleRespondClarification = async (action: LawMindRequiresAction) => {
    if (!sessionId) {
      return;
    }
    setBusy(true);
    try {
      await resumeChatAction(apiBase, {
        sessionId,
        actionId: action.id,
        decision: "respond",
        clarificationAnswers: buildClarificationAnswerMap(
          action.clarificationQuestions ?? [],
          clarificationDraft,
        ),
      });
      await onChatResumeComplete?.();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "提交失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleMatterApproval = async (
    action: LawMindRequiresAction,
    status: "approved" | "rejected",
  ) => {
    if (!action.matterId || !action.approvalId) {
      return;
    }
    setBusy(true);
    try {
      await resolveMatterApproval(apiBase, {
        matterId: action.matterId,
        approvalId: action.approvalId,
        status,
      });
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "审批失败"));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  const approvals = (summary as { approvals?: ApprovalRequest[] })?.approvals ?? [];
  const matterActions: LawMindRequiresAction[] = approvals
    .filter((a) => a.status === "pending")
    .map((a) => ({
      id: a.approvalId,
      kind: "matter_approval" as const,
      threadId: `${a.matterId}::_::_`,
      title: "案件待审批",
      summary: a.reason,
      matterId: a.matterId,
      approvalId: a.approvalId,
      decisions: ["approve", "reject"],
      createdAt: a.requestedAt,
    }));

  const chatActions = sessionRequiresActions;

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="待处理">
      <div className="lm-wizard lm-action-hub-panel">
        <div className="lm-settings-header">
          <h2>待处理</h2>
          <button type="button" className="lm-settings-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {loading ? <p className="lm-meta">加载中…</p> : null}
        {error ? <p className="lm-error">{error}</p> : null}
        {summary ? (
          <p className="lm-meta lm-action-hub-stats">
            共 {summary.total ?? 0} 项：案件审批 {summary.pendingApprovals ?? 0} · 待办队列{" "}
            {summary.openQueueItems ?? 0} · 后台任务 {summary.activeJobs ?? 0} · 对话待处理{" "}
            {summary.chatRequiresActionCount ?? 0}
            {(summary).pendingToolApprovals
              ? ` · 工具待批准 ${(summary).pendingToolApprovals}`
              : ""}
          </p>
        ) : null}

        <div className="lm-action-hub-tabs">
          <button
            type="button"
            className={hubTab === "chat" ? "lm-tab lm-tab-active" : "lm-tab"}
            onClick={() => setHubTab("chat")}
          >
            对话 ({chatActions.length})
          </button>
          <button
            type="button"
            className={hubTab === "matter" ? "lm-tab lm-tab-active" : "lm-tab"}
            onClick={() => setHubTab("matter")}
          >
            案件 ({matterActions.length})
          </button>
          <button
            type="button"
            className={hubTab === "queue" ? "lm-tab lm-tab-active" : "lm-tab"}
            onClick={() => setHubTab("queue")}
          >
            队列 ({summary?.openQueueItems ?? 0})
          </button>
        </div>

        {hubTab === "chat" ? (
          <>
            {((summary as ActionSummaryPayload)?.toolApprovals?.length ?? 0) > 0 &&
            chatActions.length === 0 ? (
              <section className="lm-action-hub-section">
                <h3>工作区工具待批准</h3>
                <ul className="lm-meta lm-action-hub-tool-list">
                  {((summary as ActionSummaryPayload).toolApprovals ?? []).map((t) => (
                    <li key={`${t.sessionId}:${t.actionId}`}>
                      {t.toolName ?? t.title} — {t.summary.slice(0, 60)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {chatActions.length > 0 ? (
              <LawmindRequiresActionCard
                actions={chatActions}
                sessionId={sessionId}
                clarificationDraft={clarificationDraft}
                onClarificationDraftChange={(key, value) =>
                  setClarificationDraft((d) => ({ ...d, [key]: value }))
                }
                onApproveTool={handleApproveTool}
                onRejectTool={handleRejectTool}
                onRespondClarification={handleRespondClarification}
                busy={busy}
              />
            ) : (
              <p className="lm-meta">当前对话无待处理项。</p>
            )}
          </>
        ) : null}

        {hubTab === "matter" ? (
          matterActions.length > 0 ? (
            <LawmindRequiresActionCard
              actions={matterActions}
              onResolveMatterApproval={handleMatterApproval}
              busy={busy}
            />
          ) : (
            <p className="lm-meta">暂无案件审批。</p>
          )
        ) : null}

        {hubTab === "queue" ? (
          (summary?.openQueueItems ?? 0) > 0 ? (
            <p className="lm-meta">
              有 {summary?.openQueueItems} 项待办队列项，请在案件工作台「任务」页处理。
              {summary?.activeJobs ? ` 另有 ${summary.activeJobs} 个后台任务运行中。` : ""}
            </p>
          ) : (
            <p className="lm-meta">待办队列为空。</p>
          )
        ) : null}

        <div className="lm-action-hub-footer">
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </div>
    </div>
  );
}

/** Header badge button */
export function LawmindActionHubButton(props: {
  total: number;
  onClick: () => void;
}): ReactNode {
  const { total, onClick } = props;
  if (total <= 0) {
    return null;
  }
  return (
    <button
      type="button"
      className="lm-btn lm-btn-secondary lm-btn-sm lm-action-hub-trigger"
      onClick={onClick}
      title="查看待澄清、待批准与案件审批"
    >
      待处理 ({total})
    </button>
  );
}

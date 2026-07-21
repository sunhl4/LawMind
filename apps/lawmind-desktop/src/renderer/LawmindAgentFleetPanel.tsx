/**
 * 在办 — 与对话工作台同构：左侧待办目录 · 右侧办理区。
 * 职责：集中处理签批 / 补充 / 批准；新任务回对话。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApprovalRequest } from "../../../../src/lawmind/core/contracts.ts";
import {
  loadActionSummary,
  resumeChatAction,
  resolveMatterApproval,
  buildClarificationAnswerMap,
  type LawMindRequiresAction,
  type ActionSummaryPayload,
} from "./lawmind-requires-action";
import { LawmindRequiresActionCard } from "./LawmindRequiresActionCard";
import {
  loadAgentFleet,
  loadAgentPresets,
  loadFleetTranscript,
  type AgentFleetSummary,
  type AgentPreset,
  type AgentRunSummary,
} from "./lawmind-agent-fleet-api";
import { errorMessage } from "./api-client";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";
import { extractApprovalDocumentPreview } from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import { LawmindApprovalDocReader } from "./LawmindApprovalDocReader";
import { LawmindAgentFleetSpawnBar } from "./LawmindAgentFleetSpawnBar";
import { LawmindToolArgsEditDialog } from "./LawmindToolArgsEditDialog";

function needsLawyer(run: AgentRunSummary): boolean {
  return (
    run.status === "awaiting_clarification" ||
    run.status === "awaiting_approval" ||
    run.status === "awaiting_review"
  );
}

function statusKind(status: AgentRunSummary["status"]): "review" | "clarify" | "approve" {
  if (status === "awaiting_clarification") {
    return "clarify";
  }
  if (status === "awaiting_approval") {
    return "approve";
  }
  return "review";
}

function statusLabel(status: AgentRunSummary["status"]): string {
  switch (status) {
    case "awaiting_review":
      return "待签批";
    case "awaiting_clarification":
      return "待补充";
    case "awaiting_approval":
      return "待批准";
    default:
      return "待处理";
  }
}

function resumeSessionId(
  action: LawMindRequiresAction,
  selected: AgentRunSummary | null,
  activeSessionId?: string,
): string | undefined {
  return action.sessionId?.trim() || selected?.sessionId?.trim() || activeSessionId?.trim() || undefined;
}

export type LawmindAgentFleetPanelProps = {
  apiBase: string;
  /** 开新任务时的案件归因；待办列表始终全工作区，不用此字段过滤。 */
  matterId?: string | null;
  sessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  assistantDisplayById: Record<string, string>;
  canDelegate: boolean;
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
  onRefreshSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onNewChat: () => void;
  onOpenAgentsWorkflows?: () => void;
  onOpenWorkflowLibrary?: () => void;
  onDelegate: () => void;
  onSpawnPreset: (preset: AgentPreset) => void;
  onOpenCollaboration?: () => void;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview?: (taskId?: string, matterId?: string) => void;
  onOpenReviewCampaign?: () => void;
};

export function LawmindAgentFleetPanel(props: LawmindAgentFleetPanelProps): ReactNode {
  const {
    apiBase,
    matterId,
    sessionId,
    sessionRequiresActions = [],
    canDelegate,
    needsDecisionFocus = false,
    onClearNeedsDecisionFocus,
    onRefreshSummary,
    onChatResumeComplete,
    onNewChat,
    onOpenAgentsWorkflows,
    onOpenWorkflowLibrary,
    onDelegate,
    onSpawnPreset,
    onOpenCollaboration,
    onOpenChatSession,
    onOpenReview,
    onOpenReviewCampaign,
  } = props;

  const openAgentsWorkflows = onOpenAgentsWorkflows ?? onOpenWorkflowLibrary ?? (() => undefined);

  const [fleet, setFleet] = useState<AgentFleetSummary | null>(null);
  const [summary, setSummary] = useState<ActionSummaryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<Set<string>>(() => new Set());
  const [clarificationDraft, setClarificationDraft] = useState<Record<string, string>>({});
  const [runActions, setRunActions] = useState<LawMindRequiresAction[]>([]);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [argsEditOpen, setArgsEditOpen] = useState(false);
  const [argsEditError, setArgsEditError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  /**
   * 待办目录与侧栏「待我拍板」一致：始终拉全工作区，不跟对话 contextMatterId 过滤。
   * 否则切换/回填案件上下文后，其它案件的签批会在数秒轮询后「突然消失」。
   * matterId 仅用于开新任务时的案件归因（SpawnBar）。
   */
  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!apiBase) {
        return;
      }
      if (!opts?.silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const [f, s] = await Promise.all([
          loadAgentFleet(apiBase, null),
          loadActionSummary(apiBase),
        ]);
        setFleet(f);
        setSummary(s);
        if (!opts?.silent) {
          onRefreshSummary?.();
        }
      } catch (e) {
        setError(errorMessage(e, "无法加载在办事项"));
      } finally {
        setLoading(false);
        setHasLoaded(true);
      }
    },
    [apiBase, onRefreshSummary],
  );

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refresh({ silent: true });
      }
    }, 5_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!apiBase) {
      setPresets([]);
      return;
    }
    let cancelled = false;
    setPresetsLoading(true);
    void loadAgentPresets(apiBase)
      .then((rows) => {
        if (!cancelled) {
          setPresets(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPresets([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPresetsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const queue = useMemo(() => {
    const runs = (fleet?.runs ?? []).filter(needsLawyer);
    const seen = new Set(runs.map((r) => r.taskId).filter((t): t is string => Boolean(t)));
    const fromDrafts: AgentRunSummary[] = (summary?.pendingReviewDrafts ?? [])
      .filter((d) => d.taskId && !seen.has(d.taskId))
      .map((d) => ({
        // 与 build-agent-fleet 的 review:${taskId} 对齐，避免轮询前后 id 跳变导致选中项闪没
        id: `review:${d.taskId}`,
        kind: "pending_review" as const,
        status: "awaiting_review" as const,
        title: d.title?.trim() || "待签批文书",
        matterId: d.matterId,
        taskId: d.taskId,
        updatedAt: d.createdAt,
        createdAt: d.createdAt,
        priority: 0,
      }));
    const merged = [...runs, ...fromDrafts];
    return snoozed.size === 0 ? merged : merged.filter((r) => !snoozed.has(r.id));
  }, [fleet?.runs, summary?.pendingReviewDrafts, snoozed]);

  useEffect(() => {
    if (queue.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && queue.some((r) => r.id === selectedId)) {
      return;
    }
    setSelectedId(queue[0].id);
  }, [queue, selectedId]);

  const current = queue.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    const sid = current?.sessionId?.trim();
    if (!apiBase || !sid) {
      setRunActions([]);
      return;
    }
    let cancelled = false;
    void loadFleetTranscript(apiBase, sid)
      .then((payload) => {
        if (!cancelled) {
          setRunActions(payload?.pendingRequiresAction ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRunActions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, current?.sessionId, fleet?.counts.awaitingAction]);

  const workspaceChatActions = useMemo(() => {
    const rows = summary?.chatRequiresActions ?? [];
    const out: LawMindRequiresAction[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const a of row.actions) {
        if (seen.has(a.id)) {
          continue;
        }
        seen.add(a.id);
        out.push({ ...a, sessionId: a.sessionId ?? row.sessionId });
      }
    }
    return out;
  }, [summary?.chatRequiresActions]);

  const allActions = useMemo(() => {
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
    const sid = current?.sessionId?.trim();
    const chatPool = sid
      ? [
          ...runActions,
          ...workspaceChatActions.filter((a) => a.sessionId === sid),
          ...(sessionId === sid ? sessionRequiresActions : []),
        ]
      : [...workspaceChatActions, ...sessionRequiresActions];
    const seen = new Set<string>();
    const out: LawMindRequiresAction[] = [];
    for (const a of [...chatPool, ...matterActions]) {
      if (seen.has(a.id)) {
        continue;
      }
      seen.add(a.id);
      out.push(a);
    }
    return out;
  }, [
    summary,
    current?.sessionId,
    runActions,
    workspaceChatActions,
    sessionRequiresActions,
    sessionId,
  ]);

  const advanceAfter = useCallback(
    (doneId?: string) => {
      const rest = queue.filter((r) => r.id !== doneId);
      setSelectedId(rest[0]?.id ?? null);
    },
    [queue],
  );

  const approveTool = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      setError("请先打开对应对话。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, { sessionId: sid, actionId: action.id, decision: "approve" });
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "批准失败"));
    } finally {
      setBusy(false);
    }
  };

  const approveToolEdit = async (action: LawMindRequiresAction, editedArgs: Record<string, unknown>) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      setError("请先打开对应对话。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, {
        sessionId: sid,
        actionId: action.id,
        decision: "edit",
        editedArgs,
      });
      setArgsEditOpen(false);
      setArgsEditError(null);
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "按修改批准失败"));
    } finally {
      setBusy(false);
    }
  };

  const rejectTool = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, { sessionId: sid, actionId: action.id, decision: "reject" });
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "已驳回"));
    } finally {
      setBusy(false);
    }
  };

  const respondClarify = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      setError("请到对话中补充。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, {
        sessionId: sid,
        actionId: action.id,
        decision: "respond",
        clarificationAnswers: buildClarificationAnswerMap(
          action.clarificationQuestions ?? [],
          clarificationDraft,
        ),
      });
      setClarificationDraft({});
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "提交失败"));
    } finally {
      setBusy(false);
    }
  };

  const resolveMatter = async (action: LawMindRequiresAction, status: "approved" | "rejected") => {
    if (!action.matterId || !action.approvalId) {
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resolveMatterApproval(apiBase, {
        matterId: action.matterId,
        approvalId: action.approvalId,
        status,
      });
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "处理失败"));
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel =
    current?.status === "awaiting_review" || current?.taskId
      ? "进入文书台改稿"
      : current?.status === "awaiting_clarification"
        ? "去对话补充"
        : current?.status === "awaiting_approval"
          ? "批准"
          : "打开";

  const runPrimary = () => {
    if (!current || busy) {
      return;
    }
    if ((current.status === "awaiting_review" || current.taskId) && onOpenReview) {
      onOpenReview(current.taskId, current.matterId);
      return;
    }
    if (current.status === "awaiting_clarification" && current.sessionId) {
      onOpenChatSession(current.sessionId, current.matterId, current.assistantId);
      return;
    }
    if (current.status === "awaiting_approval") {
      const first = allActions[0];
      if (first?.kind === "matter_approval") {
        void resolveMatter(first, "approved");
        return;
      }
      if (first) {
        void approveTool(first);
        return;
      }
    }
    if (current.sessionId) {
      onOpenChatSession(current.sessionId, current.matterId, current.assistantId);
    }
  };

  const showForm =
    current != null &&
    (current.status === "awaiting_approval" || current.status === "awaiting_clarification") &&
    allActions.length > 0;

  const approvalAction =
    current?.status === "awaiting_approval"
      ? (allActions.find((a) => a.kind === "tool_approval") ?? allActions[0] ?? null)
      : null;
  const approvalDoc = approvalAction?.toolArgs
    ? extractApprovalDocumentPreview(approvalAction.toolArgs)
    : null;
  const readingMode = Boolean(approvalDoc && current?.status === "awaiting_approval");

  const displayTitle = current
    ? readingMode && approvalDoc
      ? approvalDoc.title
      : sanitizeLawyerFacingText(current.title, current.toolName)
    : "";

  const runningCount = (fleet?.runs ?? []).filter(
    (r) => r.status === "running" || r.status === "queued" || r.status === "scheduled",
  ).length;

  return (
    <div
      className="lm-agents-wb"
      data-testid="lm-agent-fleet-panel"
      data-needs-decision={needsDecisionFocus ? "true" : undefined}
      aria-busy={loading || busy || undefined}
    >
      <header className="lm-agents-wb-bar">
        <h1>在办</h1>
        <div className="lm-agents-wb-bar-meta">
          {queue.length > 0 ? (
            <span className="lm-agents-wb-pill" data-tone="warn" data-testid="lm-fleet-decision-focus-lead">
              {queue.length} 件待办
            </span>
          ) : (
            <span className="lm-agents-wb-pill" data-testid="lm-fleet-decision-focus-lead">
              暂无待办
            </span>
          )}
          {runningCount > 0 ? (
            <span className="lm-agents-wb-pill">{runningCount} 件办理中</span>
          ) : null}
          {needsDecisionFocus ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              data-testid="lm-fleet-show-all"
              onClick={() => onClearNeedsDecisionFocus?.()}
            >
              退出聚焦
            </button>
          ) : null}
        </div>
        <LawmindAgentFleetSpawnBar
          presets={presets}
          presetsLoading={presetsLoading}
          matterId={matterId}
          canDelegate={canDelegate}
          onNewChat={onNewChat}
          onOpenAgentsWorkflows={openAgentsWorkflows}
          onDelegate={onDelegate}
          onSpawnPreset={onSpawnPreset}
          onOpenCollaboration={onOpenCollaboration}
          onOpenReviewCampaign={onOpenReviewCampaign}
        />
      </header>

      {error ? (
        <div className="lm-callout lm-callout-danger lm-agents-wb-error" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}

      {loading && !hasLoaded ? (
        <p className="lm-meta" style={{ padding: "16px 20px" }}>
          加载中…
        </p>
      ) : null}

      {hasLoaded && queue.length === 0 ? (
        <div className="lm-agents-wb-empty" data-testid="lm-fleet-decision-empty">
          <h2>暂无待办</h2>
          <p>需要您签批、补充或批准的事项会出现在左侧目录。新任务请在「对话」下达。</p>
          <div className="lm-agents-wb-empty-actions">
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onNewChat}>
              打开对话
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-accent"
              data-testid="lm-fleet-primary-review"
              onClick={() => onOpenReview?.()}
            >
              打开文书台
            </button>
          </div>
        </div>
      ) : null}

      {queue.length > 0 && current ? (
        <div className="lm-agents-wb-split">
          <aside className="lm-agents-wb-list" aria-label="待办目录">
            <div className="lm-agents-wb-list-scroll">
              {queue.map((run) => {
                const kind = statusKind(run.status);
                const rowTitle = sanitizeLawyerFacingText(run.title, run.toolName)
                  .replace(/^待审定：\s*/, "")
                  .replace(/^待批准：\s*/, "");
                return (
                  <button
                    key={run.id}
                    type="button"
                    className="lm-agents-wb-row"
                    data-kind={kind}
                    aria-selected={run.id === current.id}
                    aria-label={`${statusLabel(run.status)} ${rowTitle}`}
                    data-testid={`lm-agent-fleet-card-${run.kind}`}
                    onClick={() => setSelectedId(run.id)}
                  >
                    <span className="lm-agents-wb-row-kind" data-kind={kind}>
                      {statusLabel(run.status).replace(/^待/, "")}
                    </span>
                    <span className="lm-agents-wb-row-title">{rowTitle}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section
            className={`lm-agents-wb-detail${readingMode ? " lm-agents-wb-detail--reading" : ""}`}
            aria-label="办理区"
          >
            <header className="lm-agents-wb-detail-head">
              <div className="lm-agents-wb-detail-head-row">
                <span className="lm-agents-wb-kicker" data-kind={statusKind(current.status)}>
                  {statusLabel(current.status)}
                </span>
                {!readingMode && current.matterId && !current.matterId.startsWith('临时') ? (
                  <span className="lm-agents-wb-detail-meta-inline">案件 {current.matterId}</span>
                ) : null}
              </div>
              <h2>{displayTitle.replace(/^待审定：\s*/, "")}</h2>
            </header>

            {readingMode && approvalDoc ? (
              <LawmindApprovalDocReader doc={approvalDoc} showTitle={false} />
            ) : (
              <div className="lm-agents-wb-detail-scroll">
                <div className="lm-agents-wb-detail-inner">
                  {showForm ? (
                    <div className="lm-agents-wb-block" id="lm-fleet-panel-actions">
                      <LawmindRequiresActionCard
                        actions={allActions}
                        sessionId={current.sessionId ?? sessionId}
                        clarificationDraft={clarificationDraft}
                        onClarificationDraftChange={(key, value) =>
                          setClarificationDraft((d) => ({ ...d, [key]: value }))
                        }
                        onApproveTool={approveTool}
                        onApproveToolEdit={approveToolEdit}
                        onRejectTool={rejectTool}
                        onRespondClarification={respondClarify}
                        onResolveMatterApproval={resolveMatter}
                        busy={busy}
                      />
                    </div>
                  ) : (
                    <div id="lm-fleet-panel-actions" hidden />
                  )}
                </div>
              </div>
            )}

            <footer className="lm-agents-wb-dock">
              <button
                type="button"
                className="lm-btn lm-btn-accent"
                data-testid={
                  current.status === "awaiting_review" || current.taskId
                    ? "lm-fleet-primary-review"
                    : "lm-ceremony-primary"
                }
                disabled={busy}
                onClick={runPrimary}
              >
                {primaryLabel}
              </button>
              {current.status === "awaiting_approval" && approvalAction ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    if (approvalAction.kind === "matter_approval") {
                      void resolveMatter(approvalAction, "rejected");
                      return;
                    }
                    void rejectTool(approvalAction);
                  }}
                >
                  驳回
                </button>
              ) : (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost"
                  onClick={() => {
                    setSnoozed((prev) => new Set(prev).add(current.id));
                  }}
                >
                  稍后
                </button>
              )}
              {current.status === "awaiting_approval" &&
              approvalAction?.kind === "tool_approval" ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost"
                  disabled={busy}
                  data-testid="lm-ceremony-edit-args"
                  onClick={() => {
                    setArgsEditError(null);
                    setArgsEditOpen(true);
                  }}
                >
                  改拟稿…
                </button>
              ) : null}
              {current.sessionId && current.status !== "awaiting_clarification" ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost"
                  onClick={() =>
                    onOpenChatSession(current.sessionId!, current.matterId, current.assistantId)
                  }
                >
                  相关对话
                </button>
              ) : null}
            </footer>

            <LawmindToolArgsEditDialog
              open={argsEditOpen && approvalAction?.kind === "tool_approval"}
              toolArgs={approvalAction?.kind === "tool_approval" ? approvalAction.toolArgs : null}
              busy={busy}
              error={argsEditError}
              onCancel={() => {
                setArgsEditOpen(false);
                setArgsEditError(null);
              }}
              onApprove={(edited) => {
                if (!approvalAction || approvalAction.kind !== "tool_approval") {
                  return;
                }
                setArgsEditError(null);
                void approveToolEdit(approvalAction, edited);
              }}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

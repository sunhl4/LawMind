import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { LawmindAgentFleetCard } from "./LawmindAgentFleetCard";
import { LawmindAgentFleetSpawnBar } from "./LawmindAgentFleetSpawnBar";
import { LawmindAgentFleetTranscript } from "./LawmindAgentFleetTranscript";
import {
  loadAgentFleet,
  loadAgentPresets,
  loadFleetTranscript,
  type AgentFleetSummary,
  type AgentPreset,
  type AgentRunSummary,
} from "./lawmind-agent-fleet-api";
import { errorMessage } from "./api-client";
import { apiSendJson } from "./api-client";

function runNeedsDecision(run: AgentRunSummary): boolean {
  return (
    run.status === "awaiting_clarification" ||
    run.status === "awaiting_approval" ||
    run.status === "awaiting_review"
  );
}

function formatFleetSyncedAgo(at: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 5) {
    return "刚刚";
  }
  if (sec < 60) {
    return `${sec} 秒前`;
  }
  const min = Math.floor(sec / 60);
  return `${min} 分钟前`;
}

type Props = {
  apiBase: string;
  matterId?: string | null;
  sessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  assistantDisplayById: Record<string, string>;
  canDelegate: boolean;
  /** When true (from「待我拍板」), list only awaiting_* runs. */
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
  onRefreshSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onNewChat: () => void;
  onOpenAgentsWorkflows?: () => void;
  /** @deprecated Use onOpenAgentsWorkflows */
  onOpenWorkflowLibrary?: () => void;
  onDelegate: () => void;
  onSpawnPreset: (preset: AgentPreset) => void;
  onOpenCollaboration?: () => void;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview?: (taskId: string) => void;
};

function resumeSessionIdForAction(
  action: LawMindRequiresAction,
  selectedRun: AgentRunSummary | null,
  activeSessionId?: string,
): string | undefined {
  return action.sessionId?.trim() || selectedRun?.sessionId?.trim() || activeSessionId?.trim() || undefined;
}

export function LawmindAgentFleetPanel(props: Props): ReactNode {
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
  } = props;
  const openAgentsWorkflows = onOpenAgentsWorkflows ?? onOpenWorkflowLibrary ?? (() => undefined);

  const [fleet, setFleet] = useState<AgentFleetSummary | null>(null);
  const [summary, setSummary] = useState<ActionSummaryPayload | null>(null);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<AgentRunSummary | null>(null);
  const [detailTab, setDetailTab] = useState<"actions" | "transcript">("actions");
  const [clarificationDraft, setClarificationDraft] = useState<Record<string, string>>({});
  const [selectedRunActions, setSelectedRunActions] = useState<LawMindRequiresAction[]>([]);
  const [includeAllMatters, setIncludeAllMatters] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [, setSyncTick] = useState(0);
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());

  const effectiveMatterId = includeAllMatters ? null : matterId;

  const refresh = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [f, s, p] = await Promise.all([
        loadAgentFleet(apiBase, effectiveMatterId),
        loadActionSummary(apiBase, effectiveMatterId ?? undefined),
        loadAgentPresets(apiBase),
      ]);
      setFleet(f);
      setSummary(s);
      setPresets(p);
      onRefreshSummary?.();
    } catch (e) {
      setError(errorMessage(e, "无法加载在办事项"));
    } finally {
      setLoading(false);
      setPresetsLoading(false);
    }
  }, [apiBase, effectiveMatterId, onRefreshSummary]);

  useEffect(() => {
    setPresetsLoading(true);
    void refresh().then(() => setLastSyncedAt(Date.now()));
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refresh().then(() => setLastSyncedAt(Date.now()));
    };
    const t = window.setInterval(tick, 5_000);
    const labelTick = window.setInterval(() => setSyncTick((n) => n + 1), 1_000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      window.clearInterval(labelTick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const visibleRuns = useMemo(() => {
    const runs = fleet?.runs ?? [];
    if (!needsDecisionFocus) {
      return runs;
    }
    return runs.filter(runNeedsDecision);
  }, [fleet?.runs, needsDecisionFocus]);

  /** Prefer first card that needs lawyer input so 待办 / 澄清入口立刻可见。 */
  useEffect(() => {
    if (visibleRuns.length === 0) {
      setSelectedRun(null);
      return;
    }
    if (selectedRun && visibleRuns.some((r) => r.id === selectedRun.id)) {
      return;
    }
    const needsInput = visibleRuns.find(runNeedsDecision) ?? visibleRuns[0];
    setSelectedRun(needsInput);
    if (runNeedsDecision(needsInput)) {
      setDetailTab("actions");
    }
  }, [visibleRuns, selectedRun]);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    const running = (fleet?.runs ?? [])
      .filter((r) => r.kind === "workflow_job" && (r.status === "queued" || r.status === "running"))
      .map((r) => r.jobId)
      .filter((id): id is string => Boolean(id))
      .slice(0, 3);
    const wanted = new Set(running);
    for (const [jid, es] of eventSourcesRef.current.entries()) {
      if (!wanted.has(jid)) {
        es.close();
        eventSourcesRef.current.delete(jid);
      }
    }
    for (const jobId of running) {
      if (eventSourcesRef.current.has(jobId)) {
        continue;
      }
      try {
        const es = new EventSource(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/stream`);
        eventSourcesRef.current.set(jobId, es);
        es.addEventListener("message", () => void refresh());
        es.addEventListener("error", () => {
          es.close();
          eventSourcesRef.current.delete(jobId);
        });
      } catch {
        /* EventSource unavailable */
      }
    }
    return () => {
      for (const es of eventSourcesRef.current.values()) {
        es.close();
      }
      eventSourcesRef.current.clear();
    };
  }, [apiBase, fleet?.runs]);

  useEffect(() => {
    const sid = selectedRun?.sessionId?.trim();
    if (!apiBase || !sid) {
      setSelectedRunActions([]);
      return;
    }
    let cancelled = false;
    void loadFleetTranscript(apiBase, sid)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setSelectedRunActions(payload?.pendingRequiresAction ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedRunActions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, selectedRun?.sessionId, fleet?.counts.awaitingAction]);

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

  const allRequiresActions = useMemo(() => {
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
    const selectedSid = selectedRun?.sessionId?.trim();
    const chatPool = selectedSid
      ? [
          ...selectedRunActions,
          ...workspaceChatActions.filter((a) => a.sessionId === selectedSid),
          ...(sessionId === selectedSid ? sessionRequiresActions : []),
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
    selectedRun?.sessionId,
    selectedRunActions,
    workspaceChatActions,
    sessionRequiresActions,
    sessionId,
  ]);

  const handleApproveTool = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionIdForAction(action, selectedRun, sessionId);
    if (!sid) {
      setError("请先打开对应对话会话。");
      return;
    }
    setBusy(true);
    try {
      await resumeChatAction(apiBase, { sessionId: sid, actionId: action.id, decision: "approve" });
      await onChatResumeComplete?.();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "批准失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleRejectTool = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionIdForAction(action, selectedRun, sessionId);
    if (!sid) {
      return;
    }
    setBusy(true);
    try {
      await resumeChatAction(apiBase, { sessionId: sid, actionId: action.id, decision: "reject" });
      await onChatResumeComplete?.();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "已拒绝"));
    } finally {
      setBusy(false);
    }
  };

  const handleRespondClarification = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionIdForAction(action, selectedRun, sessionId);
    if (!sid) {
      setError("找不到待澄清会话，请点「打开对话澄清」后在对话中补充。");
      return;
    }
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
    } catch (e) {
      setError(errorMessage(e, "提交澄清失败"));
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
      setError(errorMessage(e, "审批处理失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    setBusy(true);
    try {
      await apiSendJson(apiBase, `/api/jobs/${encodeURIComponent(jobId)}/cancel`, "POST", {});
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "取消失败"));
    } finally {
      setBusy(false);
    }
  };

  const openRun = (run: AgentRunSummary) => {
    setSelectedRun(run);
    if (
      run.status === "awaiting_clarification" ||
      run.status === "awaiting_approval" ||
      run.status === "awaiting_review"
    ) {
      setDetailTab("actions");
    } else if (run.sessionId) {
      setDetailTab("transcript");
    } else {
      setDetailTab("actions");
    }
  };

  const transcriptSessionId =
    selectedRun?.sessionId ??
    (selectedRun?.kind === "tool_approval" ? sessionId ?? null : null);

  const showAwaitingClarifyHint =
    selectedRun?.status === "awaiting_clarification" &&
    allRequiresActions.filter((a) => a.kind === "clarification").length === 0;
  const selectedSpecialization = selectedRun?.assistantId
    ? fleet?.specialization?.[selectedRun.assistantId]
    : undefined;

  const decisionCount = visibleRuns.length;
  const awaitingInFleet = (fleet?.runs ?? []).filter(runNeedsDecision).length;

  return (
    <div
      className="lm-agent-fleet-panel"
      data-testid="lm-agent-fleet-panel"
      data-needs-decision={needsDecisionFocus ? "true" : undefined}
      aria-busy={loading || busy || undefined}
    >
      <header className="lm-agent-fleet-header">
        <div>
          {needsDecisionFocus ? (
            <p className="lm-meta" data-testid="lm-fleet-decision-focus-lead">
              待我拍板
              {awaitingInFleet > 0 ? ` · ${awaitingInFleet} 项` : " · 暂无待决"}
              。在右侧澄清、批准或进入文书台。
            </p>
          ) : (
            <p className="lm-meta">
              单条卡点可在右侧处理。新任务请回「对话」下达。
              {fleet ? ` · ${fleet.counts.active} 项进行中` : ""}
              {matterId && !includeAllMatters ? " · 当前案件" : includeAllMatters ? " · 全部案件" : ""}
            </p>
          )}
        </div>
        <div className="lm-agent-fleet-header-actions">
          {needsDecisionFocus ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-fleet-show-all"
              onClick={() => onClearNeedsDecisionFocus?.()}
            >
              显示全部
            </button>
          ) : null}
          {matterId ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              data-testid="lm-fleet-scope-toggle"
              aria-pressed={includeAllMatters}
              onClick={() => setIncludeAllMatters((v) => !v)}
              title={includeAllMatters ? "仅看当前案件" : "查看全部案件在办"}
            >
              {includeAllMatters ? "仅当前案件" : "全部案件"}
            </button>
          ) : null}
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={loading}
            onClick={() => void refresh().then(() => setLastSyncedAt(Date.now()))}
          >
            刷新
          </button>
          {lastSyncedAt ? (
            <span className="lm-meta" data-testid="lm-fleet-last-synced" title="自动每 5 秒同步（窗口不可见时暂停）">
              {loading ? "同步中…" : `已同步 ${formatFleetSyncedAgo(lastSyncedAt)}`}
            </span>
          ) : null}
        </div>
      </header>

      <LawmindAgentFleetSpawnBar
        presets={presets}
        presetsLoading={presetsLoading}
        matterId={effectiveMatterId}
        canDelegate={canDelegate}
        onNewChat={onNewChat}
        onOpenAgentsWorkflows={openAgentsWorkflows}
        onDelegate={onDelegate}
        onSpawnPreset={onSpawnPreset}
        onOpenCollaboration={onOpenCollaboration}
      />

      {(summary?.pendingReviewDrafts?.length ?? 0) > 0 && onOpenReview ? (
        <section
          className="lm-agent-fleet-review-rail"
          aria-label="待审文书"
          data-testid="lm-fleet-pending-reviews"
        >
          <h4 className="lm-meta">待审文书</h4>
          <ul className="lm-meta">
            {(summary?.pendingReviewDrafts ?? []).slice(0, 5).map((d) => (
              <li key={d.taskId}>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  data-testid={`lm-fleet-review-${d.taskId}`}
                  onClick={() => onOpenReview(d.taskId)}
                >
                  {d.title?.trim() || d.taskId}
                  {d.reviewStatus === "modified" ? " · 已修订" : " · 进入文书台"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}

      <div className="lm-agent-fleet-body">
        <section className="lm-agent-fleet-list" aria-label={needsDecisionFocus ? "待我拍板" : "在办交办"}>
          {loading && !fleet ? <p className="lm-meta">加载中…</p> : null}
          {decisionCount === 0 && !loading ? (
            <div className="lm-agent-fleet-empty" data-testid="lm-fleet-decision-empty">
              {needsDecisionFocus ? (
                <>
                  <p className="lm-meta">暂无待拍板事项。</p>
                  <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onNewChat}>
                    回对话
                  </button>
                </>
              ) : (
                <p className="lm-meta">暂无进行中的任务。回到「对话」下达新任务，或点上方「+」快捷跳转。</p>
              )}
            </div>
          ) : null}
          <div className="lm-agent-fleet-cards">
            {visibleRuns.map((run) => (
              <LawmindAgentFleetCard
                key={run.id}
                run={run}
                selected={selectedRun?.id === run.id}
                onSelect={openRun}
              />
            ))}
          </div>
        </section>

        <section className="lm-agent-fleet-detail" aria-label="详情与待办">
          <div className="lm-agent-fleet-detail-tabs" role="tablist" aria-label="详情页签">
            <button
              type="button"
              role="tab"
              id="lm-fleet-tab-actions"
              className={detailTab === "actions" ? "active" : ""}
              aria-selected={detailTab === "actions"}
              aria-controls="lm-fleet-panel-actions"
              tabIndex={detailTab === "actions" ? 0 : -1}
              onClick={() => setDetailTab("actions")}
            >
              待办
              {allRequiresActions.length > 0 ? ` (${allRequiresActions.length})` : ""}
            </button>
            <button
              type="button"
              role="tab"
              id="lm-fleet-tab-transcript"
              className={detailTab === "transcript" ? "active" : ""}
              aria-selected={detailTab === "transcript"}
              aria-controls="lm-fleet-panel-transcript"
              tabIndex={detailTab === "transcript" ? 0 : -1}
              onClick={() => setDetailTab("transcript")}
            >
              轨迹
            </button>
          </div>

          {detailTab === "actions" ? (
            <div
              className="lm-agent-fleet-actions-pane"
              role="tabpanel"
              id="lm-fleet-panel-actions"
              aria-labelledby="lm-fleet-tab-actions"
            >
              {selectedRun ? (
                <div className="lm-agent-fleet-selected-meta">
                  <strong>{selectedRun.title}</strong>
                  <div className="lm-agent-fleet-selected-btns">
                    {selectedRun.status === "awaiting_review" && selectedRun.taskId && onOpenReview ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-sm"
                        data-testid="lm-fleet-primary-review"
                        onClick={() => onOpenReview(selectedRun.taskId!)}
                      >
                        进入文书台签批
                      </button>
                    ) : null}
                    {selectedRun.status !== "awaiting_review" && selectedRun.taskId && onOpenReview ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-sm"
                        onClick={() => onOpenReview(selectedRun.taskId!)}
                      >
                        进入文书台
                      </button>
                    ) : null}
                    {selectedRun.sessionId ? (
                      <button
                        type="button"
                        className={
                          selectedRun.status === "awaiting_clarification"
                            ? "lm-btn lm-btn-sm"
                            : "lm-btn lm-btn-secondary lm-btn-sm"
                        }
                        onClick={() =>
                          onOpenChatSession(
                            selectedRun.sessionId!,
                            selectedRun.matterId,
                            selectedRun.assistantId,
                          )
                        }
                      >
                        {selectedRun.status === "awaiting_clarification"
                          ? "打开对话澄清"
                          : "打开对话"}
                      </button>
                    ) : null}
                    {selectedRun.jobId && (selectedRun.status === "queued" || selectedRun.status === "running") ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-sm lm-btn-secondary"
                        disabled={busy}
                        onClick={() => void handleCancelJob(selectedRun.jobId!)}
                      >
                        取消作业
                      </button>
                    ) : null}
                  </div>
                  {selectedSpecialization && selectedSpecialization.tasksReviewed > 0 ? (
                    <div className="lm-agent-fleet-learning-summary">
                      <span>
                        该助手近期：审过 {selectedSpecialization.tasksReviewed} 份 · 一次过签批约{" "}
                        {Math.round(selectedSpecialization.firstPassRate * 100)}%
                        {selectedSpecialization.materialRewrites > 0
                          ? ` · 较大改写 ${selectedSpecialization.materialRewrites} 次`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showAwaitingClarifyHint ? (
                <div className="lm-callout lm-callout-warn" role="status">
                  <p className="lm-callout-body">
                    该事项正在等待你补充信息。右侧暂无结构化澄清表单时，请点「打开对话澄清」，在对话输入框直接补充后发送。
                  </p>
                  {selectedRun.sessionId ? (
                    <p className="lm-agent-fleet-clarify-cta">
                      <button
                        type="button"
                        className="lm-btn"
                        onClick={() =>
                          onOpenChatSession(
                            selectedRun.sessionId!,
                            selectedRun.matterId,
                            selectedRun.assistantId,
                          )
                        }
                      >
                        打开对话澄清
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {allRequiresActions.length > 0 ? (
                <LawmindRequiresActionCard
                  actions={allRequiresActions}
                  sessionId={selectedRun?.sessionId ?? sessionId}
                  clarificationDraft={clarificationDraft}
                  onClarificationDraftChange={(key, value) =>
                    setClarificationDraft((d) => ({ ...d, [key]: value }))
                  }
                  onApproveTool={handleApproveTool}
                  onRejectTool={handleRejectTool}
                  onRespondClarification={handleRespondClarification}
                  onResolveMatterApproval={handleMatterApproval}
                  busy={busy}
                />
              ) : null}

              {(summary?.toolApprovals?.length ?? 0) > 0 ? (
                <section className="lm-agent-fleet-tool-list">
                  <h4 className="lm-meta">工作区工具待批准</h4>
                  <ul className="lm-meta">
                    {(summary?.toolApprovals ?? []).map((t) => (
                      <li key={`${t.sessionId}:${t.actionId}`}>
                        {t.toolName ?? t.title} — {t.summary.slice(0, 80)}
                        {t.sessionId ? (
                          <button
                            type="button"
                            className="lm-btn lm-btn-ghost lm-btn-sm"
                            onClick={() => onOpenChatSession(t.sessionId)}
                          >
                            打开会话
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {allRequiresActions.length === 0 && (summary?.toolApprovals?.length ?? 0) === 0 ? (
                <p className="lm-meta">
                  {selectedRun?.status === "awaiting_clarification"
                    ? "暂未拉到可填的澄清表单。请点「打开对话澄清」，在对话里直接补充后发送。"
                    : selectedRun?.status === "awaiting_review"
                      ? "交付物已准备好，请点「进入文书台」核验来源、修改正文并完成签批。"
                    : "当前无待办。选择左侧「待澄清 / 待批准」卡片查看可操作项。"}
                </p>
              ) : null}
            </div>
          ) : (
            <div
              role="tabpanel"
              id="lm-fleet-panel-transcript"
              aria-labelledby="lm-fleet-tab-transcript"
              className="lm-agent-fleet-transcript-pane"
            >
              <LawmindAgentFleetTranscript
                apiBase={apiBase}
                sessionId={transcriptSessionId}
                onClose={() => setSelectedRun(null)}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

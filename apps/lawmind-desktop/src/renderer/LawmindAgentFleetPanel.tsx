/**
 * 在办 — 与对话工作台同构：左侧待办目录 · 右侧办理区。
 * 职责：集中处理签批 / 补充 / 批准（含待审文书的通过·驳回·需修改，无需全文预览）；
 * 改稿与交付预览去「文书台」。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  loadActionSummary,
  type LawMindRequiresAction,
  type ActionSummaryPayload,
} from "./lawmind-requires-action";
import {
  appendEncodedLine,
  CLARIFY_ATTACHMENTS_KEY,
  CLARIFY_SESSIONS_KEY,
  clarificationAnswersComplete,
  encodeClarificationFileAnswer,
  encodeClarificationSessionRef,
} from "../../../../src/lawmind/platform/clarification-fields.ts";
import { registerClarifyBringInHandlers } from "./lawmind-clarify-bring-in-bus";
import {
  loadAgentFleet,
  loadFleetTranscript,
  matchNeedsDecisionFocusId,
  type AgentFleetSummary,
  type AgentRunSummary,
} from "./lawmind-agent-fleet-api";
import type { NeedsDecisionDeskTarget } from "./lawmind-agents-desk";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { apiGetJson, errorMessage } from "./api-client";
import {
  buildChecklistView,
  type VerificationChecklistView,
} from "../../../../src/lawmind/deliverables/verification-checklist.ts";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { type PostApproveExportState } from "./lawmind-post-approve-export";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";
import {
  extractApprovalDocumentPreview,
  toolArgsAreDocumentWrite,
  toolArgsHaveLawyerEditableShortFields,
  toolArgsLinkedTaskId,
} from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import {
  buildFleetTeamRows,
  filterRunsByAssistant,
} from "./lawmind-fleet-team";
import {
  FLEET_GROUP_ORDER,
  fleetRunNeedsLawyer as needsLawyer,
  fleetStatusKind as statusKind,
  groupFleetQueue,
} from "./lawmind-fleet-queue";
import { collectFleetActions } from "./lawmind-fleet-actions";
import { LawmindAgentFleetListAside } from "./LawmindAgentFleetListAside";
import { LawmindAgentFleetDetail } from "./LawmindAgentFleetDetail";
import { LawmindAgentFleetEmpty } from "./LawmindAgentFleetEmpty";
import { createFleetCeremonyActions } from "./useLawmindFleetCeremonyActions";

export type LawmindAgentFleetPanelProps = {
  apiBase: string;
  /** For opening exported Word via workspace-relative path */
  workspaceDir?: string;
  sessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  assistantDisplayById: Record<string, string>;
  /** 带入轨拉取会话列表用；缺省时用当前待办的 assistantId */
  selectedAssistantId?: string;
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
  /** 对话深链：选中具体待补充/待批准行 */
  focusTarget?: NeedsDecisionDeskTarget | null;
  onFocusTargetConsumed?: () => void;
  onRefreshSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview?: (taskId?: string, matterId?: string) => void;
  /** 导出成功后在文件夹中显示 */
  onShowArtifact?: (outputPath: string) => void;
  /** 打开设置→记忆（待教团队） */
  onOpenMemoryInspector?: () => void;
};

export function LawmindAgentFleetPanel(props: LawmindAgentFleetPanelProps): ReactNode {
  const {
    apiBase,
    workspaceDir,
    sessionId,
    sessionRequiresActions = [],
    assistantDisplayById,
    selectedAssistantId: _selectedAssistantId,
    needsDecisionFocus = false,
    onClearNeedsDecisionFocus,
    focusTarget = null,
    onFocusTargetConsumed,
    onRefreshSummary,
    onChatResumeComplete,
    onOpenChatSession,
    onOpenReview,
    onShowArtifact,
    onOpenMemoryInspector,
  } = props;

  const [fleet, setFleet] = useState<AgentFleetSummary | null>(null);
  const [summary, setSummary] = useState<ActionSummaryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<Set<string>>(() => new Set());
  const [matterFilter, setMatterFilter] = useState<string>("all");
  /** 左栏：团队（按人）为默认；队列为状态分组下钻。 */
  const [listMode, setListMode] = useState<"team" | "queue">("team");
  const [assistantFilter, setAssistantFilter] = useState<string | null>(null);
  /** 待签批 / 待补充 / 待批准：默认全部折叠，律师点开再选。 */
  const [expandedGroups, setExpandedGroups] = useState<
    Set<(typeof FLEET_GROUP_ORDER)[number]>
  >(() => new Set());
  const [clarificationDraft, setClarificationDraft] = useState<Record<string, string>>({});
  const [runActions, setRunActions] = useState<LawMindRequiresAction[]>([]);
  const [argsEditOpen, setArgsEditOpen] = useState(false);
  const [argsEditError, setArgsEditError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [deskChecklistView, setDeskChecklistView] = useState<VerificationChecklistView | null>(
    null,
  );
  const [deskChecklistChecked, setDeskChecklistChecked] = useState<Record<string, boolean>>({});
  const [deskChecklistLoading, setDeskChecklistLoading] = useState(false);
  const [postApproveExport, setPostApproveExport] = useState<PostApproveExportState | null>(null);

  /**
   * 待办目录与侧栏「待我拍板」一致：始终拉全工作区，不跟对话 contextMatterId 过滤。
   * 否则切换/回填案件上下文后，其它案件的签批会在数秒轮询后「突然消失」。
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
          loadAgentFleet(apiBase, null, { windowDays: 30 }),
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

  const allQueue = useMemo(() => {
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
        assistantId: d.assistantId,
        updatedAt: d.createdAt,
        createdAt: d.createdAt,
        priority: 0,
      }));
    const merged = [...runs, ...fromDrafts];
    return snoozed.size === 0 ? merged : merged.filter((r) => !snoozed.has(r.id));
  }, [fleet?.runs, summary?.pendingReviewDrafts, snoozed]);

  const matterChoices = useMemo(() => {
    const ids = new Set<string>();
    for (const run of allQueue) {
      const mid = run.matterId?.trim();
      if (mid && !mid.startsWith("临时")) {
        ids.add(mid);
      }
    }
    return [...ids].toSorted((a, b) => a.localeCompare(b, "zh"));
  }, [allQueue]);

  const matterScopedQueue = useMemo(() => {
    if (matterFilter === "all") {
      return allQueue;
    }
    return allQueue.filter((r) => (r.matterId?.trim() || "") === matterFilter);
  }, [allQueue, matterFilter]);

  const queue = useMemo(
    () => filterRunsByAssistant(matterScopedQueue, assistantFilter),
    [matterScopedQueue, assistantFilter],
  );

  const queueGroups = useMemo(() => groupFleetQueue(queue), [queue]);

  const teamSourceRuns = useMemo(() => {
    const byId = new Map<string, AgentRunSummary>();
    for (const r of matterScopedQueue) {
      byId.set(r.id, r);
    }
    for (const r of fleet?.runs ?? []) {
      if (
        r.status === "running" ||
        r.status === "queued" ||
        r.status === "scheduled"
      ) {
        if (!byId.has(r.id)) {
          byId.set(r.id, r);
        }
      }
    }
    return [...byId.values()];
  }, [matterScopedQueue, fleet?.runs]);

  const teamRows = useMemo(
    () =>
      buildFleetTeamRows({
        runs: teamSourceRuns,
        growth: fleet?.growth,
        displayById: assistantDisplayById,
      }),
    [teamSourceRuns, fleet?.growth, assistantDisplayById],
  );

  useEffect(() => {
    if (queue.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && !queue.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [queue, selectedId]);

  /** 深链到达时先放开案件/助手筛选，避免在错误滤镜下匹配失败。 */
  useEffect(() => {
    if (!focusTarget) {
      return;
    }
    const mid = focusTarget.matterId?.trim();
    if (mid && isValidMatterId(mid)) {
      setMatterFilter(mid);
    } else {
      setMatterFilter("all");
    }
    setAssistantFilter(null);
    setListMode("queue");
  }, [focusTarget]);

  useEffect(() => {
    if (!focusTarget || allQueue.length === 0) {
      return;
    }
    const focused = matchNeedsDecisionFocusId(allQueue, focusTarget);
    if (!focused) {
      return;
    }
    const focusedRun = allQueue.find((r) => r.id === focused);
    if (focusedRun) {
      const kind = statusKind(focusedRun.status);
      setExpandedGroups((prev) => {
        if (prev.has(kind)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(kind);
        return next;
      });
    }
    setSelectedId(focused);
    onFocusTargetConsumed?.();
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-fleet-run-id="${CSS.escape(focused)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      document.getElementById("lm-fleet-panel-actions")?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }, [allQueue, focusTarget, onFocusTargetConsumed]);

  /** 侧栏「待我拍板」：有票时默认选中首项并切到队列，避免办理区空白。 */
  useEffect(() => {
    if (!needsDecisionFocus || focusTarget) {
      return;
    }
    if (matterScopedQueue.length === 0) {
      return;
    }
    if (selectedId && matterScopedQueue.some((r) => r.id === selectedId)) {
      return;
    }
    setListMode("queue");
    setSelectedId(matterScopedQueue[0].id);
    const kind = statusKind(matterScopedQueue[0].status);
    setExpandedGroups((prev) => {
      if (prev.has(kind)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(kind);
      return next;
    });
  }, [needsDecisionFocus, focusTarget, matterScopedQueue, selectedId]);

  const current = queue.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    setClarificationDraft({});
  }, [selectedId]);

  useEffect(() => {
    const taskId = current?.status === "awaiting_review" ? current.taskId?.trim() : "";
    if (!apiBase || !taskId) {
      setDeskChecklistView(null);
      setDeskChecklistChecked({});
      setDeskChecklistLoading(false);
      return;
    }
    let cancelled = false;
    setDeskChecklistLoading(true);
    void (async () => {
      try {
        const j = await apiGetJson<{ ok?: boolean; draft?: ArtifactDraft }>(
          apiBase,
          `/api/drafts/${encodeURIComponent(taskId)}`,
        );
        if (cancelled) {
          return;
        }
        const draft = j.draft;
        const view = buildChecklistView(
          draft?.deliverableType,
          draft?.verificationChecklist ?? null,
        );
        setDeskChecklistView(view);
        setDeskChecklistChecked({ ...view.state.checked });
      } catch {
        if (!cancelled) {
          const view = buildChecklistView(undefined, null);
          setDeskChecklistView(view);
          setDeskChecklistChecked({ ...view.state.checked });
        }
      } finally {
        if (!cancelled) {
          setDeskChecklistLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, current?.status, current?.taskId]);

  useEffect(() => {
    if (current?.status !== "awaiting_clarification") {
      registerClarifyBringInHandlers(null);
      return;
    }
    registerClarifyBringInHandlers({
      onAttachFile: (pin) => {
        const encoded = encodeClarificationFileAnswer(pin);
        setClarificationDraft((d) => ({
          ...d,
          [CLARIFY_ATTACHMENTS_KEY]: appendEncodedLine(d[CLARIFY_ATTACHMENTS_KEY], encoded),
        }));
      },
      onAttachSession: (ref) => {
        const encoded = encodeClarificationSessionRef(ref);
        setClarificationDraft((d) => ({
          ...d,
          [CLARIFY_SESSIONS_KEY]: appendEncodedLine(d[CLARIFY_SESSIONS_KEY], encoded),
        }));
      },
    });
    return () => registerClarifyBringInHandlers(null);
  }, [current?.status, current?.id]);

  const toggleGroup = (kind: (typeof FLEET_GROUP_ORDER)[number]) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

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

  const allActions = useMemo(
    () =>
      collectFleetActions({
        summary,
        currentSessionId: current?.sessionId,
        shellSessionId: sessionId,
        runActions,
        sessionRequiresActions,
      }),
    [summary, current?.sessionId, runActions, sessionRequiresActions, sessionId],
  );

  const advanceAfter = useCallback(
    (doneId?: string) => {
      const rest = queue.filter((r) => r.id !== doneId);
      const next = rest[0] ?? null;
      setSelectedId(next?.id ?? null);
      if (next) {
        const kind = statusKind(next.status);
        setExpandedGroups((prev) => {
          if (prev.has(kind)) {
            return prev;
          }
          const copy = new Set(prev);
          copy.add(kind);
          return copy;
        });
      }
    },
    [queue],
  );

  const isDraftReview = current?.status === "awaiting_review";

  const deskChecklistComplete =
    !deskChecklistView ||
    deskChecklistView.spec.items
      .filter((i) => i.required)
      .every((i) => deskChecklistChecked[i.id]);

  const {
    approveTool,
    approveToolEdit,
    rejectTool,
    respondClarify,
    resolveMatter,
    submitDraftReview,
    runPostApproveExport,
  } = createFleetCeremonyActions({
    apiBase,
    sessionId,
    current,
    clarificationDraft,
    deskChecklistChecked,
    deskChecklistComplete,
    postApproveExport,
    setBusy,
    setError,
    setClarificationDraft,
    setArgsEditOpen,
    setArgsEditError,
    setPostApproveExport,
    refresh,
    advanceAfter,
    onChatResumeComplete,
    onOpenReview,
    onShowArtifact,
  });

  const clarifyAction =
    current?.status === "awaiting_clarification"
      ? (allActions.find((a) => a.kind === "clarification") ?? allActions[0] ?? null)
      : null;

  const primaryLabel = isDraftReview
    ? "通过"
    : current?.status === "awaiting_clarification"
      ? "提交补充并继续"
      : current?.status === "awaiting_approval"
        ? "批准"
        : "打开";

  const clarifyComplete =
    current?.status !== "awaiting_clarification" ||
    !clarifyAction ||
    clarifyAction.kind !== "clarification" ||
    clarificationAnswersComplete(clarifyAction.clarificationQuestions ?? [], clarificationDraft);

  const primaryDisabled =
    busy ||
    (current?.status === "awaiting_clarification" && !clarifyComplete) ||
    (isDraftReview && (!deskChecklistComplete || deskChecklistLoading));

  const runPrimary = () => {
    if (!current || busy) {
      return;
    }
    if (isDraftReview) {
      void submitDraftReview("approved");
      return;
    }
    if (current.status === "awaiting_clarification" && clarifyAction?.kind === "clarification") {
      void respondClarify(clarifyAction);
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
  const approvalIsDocWrite = Boolean(
    approvalAction?.toolArgs && toolArgsAreDocumentWrite(approvalAction.toolArgs),
  );
  const approvalHasLawyerShortEdits = Boolean(
    approvalAction?.toolArgs && toolArgsHaveLawyerEditableShortFields(approvalAction.toolArgs),
  );
  const approvalHasEditableBody = Boolean(
    approvalAction?.kind === "tool_approval" &&
      approvalAction.toolArgs &&
      !approvalIsDocWrite &&
      (typeof approvalAction.toolArgs.body === "string" ||
        typeof approvalAction.toolArgs.content === "string"),
  );
  const showArgsEdit =
    approvalAction?.kind === "tool_approval" &&
    (approvalIsDocWrite ? approvalHasLawyerShortEdits : approvalHasLawyerShortEdits || approvalHasEditableBody);
  const approvalLinkedTaskId =
    (approvalAction?.toolArgs ? toolArgsLinkedTaskId(approvalAction.toolArgs) : null) ??
    current?.taskId ??
    null;

  const displayTitle = current
    ? readingMode && approvalDoc
      ? approvalDoc.title
      : sanitizeLawyerFacingText(current.title, current.toolName)
    : "";

  const pendingTeachCount = useMemo(
    () =>
      (fleet?.growth?.assistants ?? []).reduce((n, a) => n + (a.pendingAdoptions ?? 0), 0),
    [fleet?.growth],
  );

  const showTeamWorkbench =
    hasLoaded &&
    !(allQueue.length === 0 && teamRows.length === 0) &&
    !(allQueue.length > 0 && matterScopedQueue.length === 0);

  return (
    <div
      className="lm-agents-wb"
      data-testid="lm-agent-fleet-panel"
      data-needs-decision={needsDecisionFocus ? "true" : undefined}
      aria-busy={loading || busy || undefined}
    >
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

      {hasLoaded && allQueue.length === 0 && teamRows.length === 0 ? (
        <LawmindAgentFleetEmpty kind="decision" onOpenReview={onOpenReview} />
      ) : null}

      {hasLoaded && allQueue.length > 0 && matterScopedQueue.length === 0 ? (
        <LawmindAgentFleetEmpty
          kind="filter"
          onClearMatterFilter={() => setMatterFilter("all")}
        />
      ) : null}

      {showTeamWorkbench ? (
        <div className="lm-agents-wb-split">
          <LawmindAgentFleetListAside
            matterScopedQueue={matterScopedQueue}
            allQueue={allQueue}
            queue={queue}
            queueGroups={queueGroups}
            teamRows={teamRows}
            matterChoices={matterChoices}
            matterFilter={matterFilter}
            onMatterFilterChange={setMatterFilter}
            listMode={listMode}
            onListModeChange={(mode) => {
              setListMode(mode);
              if (mode === "queue") {
                setAssistantFilter(null);
              }
            }}
            assistantFilter={assistantFilter}
            onSelectAllAssistants={() => {
              setAssistantFilter(null);
              setSelectedId(null);
            }}
            onSelectAssistant={(assistantId) => {
              setAssistantFilter(assistantId);
              setListMode("team");
              const theirs = filterRunsByAssistant(matterScopedQueue, assistantId);
              if (theirs[0]) {
                const kind = statusKind(theirs[0].status);
                setExpandedGroups(new Set([kind]));
                setSelectedId(theirs[0].id);
              } else {
                setSelectedId(null);
              }
            }}
            selectedId={current?.id ?? null}
            onSelectRun={setSelectedId}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
            pendingTeachCount={pendingTeachCount}
            onOpenMemoryInspector={onOpenMemoryInspector}
            needsDecisionFocus={needsDecisionFocus}
            onClearNeedsDecisionFocus={onClearNeedsDecisionFocus}
          />
          <LawmindAgentFleetDetail
            listMode={listMode}
            current={current}
            displayTitle={displayTitle}
            readingMode={readingMode}
            approvalDoc={approvalDoc}
            isDraftReview={isDraftReview}
            showForm={showForm}
            allActions={allActions}
            sessionId={sessionId}
            clarificationDraft={clarificationDraft}
            onClarificationDraftChange={(key, value) =>
              setClarificationDraft((d) => ({ ...d, [key]: value }))
            }
            deskChecklistView={deskChecklistView}
            deskChecklistChecked={deskChecklistChecked}
            deskChecklistLoading={deskChecklistLoading}
            deskChecklistComplete={deskChecklistComplete}
            onDeskChecklistCheckedChange={setDeskChecklistChecked}
            onClearError={() => setError(null)}
            busy={busy}
            primaryLabel={primaryLabel}
            primaryDisabled={primaryDisabled}
            clarifyComplete={clarifyComplete}
            onPrimary={runPrimary}
            onDraftReview={(status) => void submitDraftReview(status)}
            onRejectApproval={() => {
              if (!approvalAction) {
                return;
              }
              if (approvalAction.kind === "matter_approval") {
                void resolveMatter(approvalAction, "rejected");
                return;
              }
              void rejectTool(approvalAction);
            }}
            onSnooze={() => {
              if (!current) {
                return;
              }
              setSnoozed((prev) => new Set(prev).add(current.id));
            }}
            approvalAction={approvalAction}
            approvalIsDocWrite={approvalIsDocWrite}
            approvalLinkedTaskId={approvalLinkedTaskId}
            showArgsEdit={showArgsEdit}
            argsEditOpen={argsEditOpen}
            argsEditError={argsEditError}
            onArgsEditOpenChange={setArgsEditOpen}
            onArgsEditErrorChange={setArgsEditError}
            onApproveTool={(a) => void approveTool(a)}
            onApproveToolEdit={(a, edited) => void approveToolEdit(a, edited)}
            onRejectTool={(a) => void rejectTool(a)}
            onRespondClarification={(a) => void respondClarify(a)}
            onResolveMatterApproval={(a, status) => void resolveMatter(a, status)}
            onOpenChatSession={onOpenChatSession}
            onOpenReview={onOpenReview}
            postApproveExport={postApproveExport}
            workspaceDir={workspaceDir}
            onPostApproveExport={() => void runPostApproveExport()}
            onPostApproveDismiss={() => setPostApproveExport(null)}
            onShowArtifact={onShowArtifact}
            onOpenError={(message) => setError(message)}
          />
        </div>
      ) : null}
    </div>
  );
}

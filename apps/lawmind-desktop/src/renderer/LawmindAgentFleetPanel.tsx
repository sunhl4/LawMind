/**
 * 在办 — 与对话工作台同构：左侧待办目录 · 右侧办理区。
 * 职责：集中处理签批 / 补充 / 批准（含待审文书的通过·驳回·需修改，无需全文预览）；
 * 改稿与交付预览经「改稿」场景页（从本页 CTA 进入；Solo 不占顶栏一级 Tab）。
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
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import {
  buildChecklistView,
  type VerificationChecklistView,
} from "../../../../src/lawmind/deliverables/verification-checklist.ts";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { validateDraftAgainstSpec } from "../../../../src/lawmind/deliverables/validator.ts";
import {
  clearPersistedPostApproveExport,
  persistPostApproveExport,
  readPersistedPostApproveExport,
  type PostApproveExportState,
} from "./lawmind-post-approve-export";
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
  defaultExpandedFleetGroups,
  fleetApprovalDockLabels,
  fleetStatusKind as statusKind,
  groupFleetQueue,
  persistFleetCollapsedGroups,
  readFleetCollapsedGroups,
  resolveFleetSelectedId,
} from "./lawmind-fleet-queue";
import { mergeFleetQueueRows } from "./lawmind-fleet-queue-merge";
import { useRequireSignoffReview } from "./lawmind-review-prefs";
import { collectFleetActions, pickFleetActionForRun } from "./lawmind-fleet-actions";
import { LawmindAgentFleetListAside } from "./LawmindAgentFleetListAside";
import { LawmindAgentFleetDetail } from "./LawmindAgentFleetDetail";
import { LawmindAgentFleetEmpty } from "./LawmindAgentFleetEmpty";
import { createFleetCeremonyActions } from "./useLawmindFleetCeremonyActions";

const FLEET_SNOOZE_STORAGE_KEY = "lawmind-agents-snooze:v1";

function readFleetSnoozed(): Set<string> {
  try {
    const raw = localStorage.getItem(FLEET_SNOOZE_STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function persistFleetSnoozed(next: Set<string>): Set<string> {
  try {
    localStorage.setItem(FLEET_SNOOZE_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* quota/private mode */
  }
  return next;
}

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
  /** 打开设置→系统健康（签批写戳失败次链） */
  onOpenHealth?: () => void;
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
    onOpenHealth,
  } = props;

  const [fleet, setFleet] = useState<AgentFleetSummary | null>(null);
  const [summary, setSummary] = useState<ActionSummaryPayload | null>(null);
  const [matterLabelById, setMatterLabelById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 「稍后看」持久化到 localStorage：刷新页面后不再全部跳回，减少重复拍板成本。
  const [snoozed, setSnoozed] = useState<Set<string>>(() => readFleetSnoozed());
  const requireSignoffReview = useRequireSignoffReview();
  const [matterFilter, setMatterFilter] = useState<string>("all");
  /** 左栏：团队（按人）为默认；队列为状态分组下钻。 */
  const [listMode, setListMode] = useState<"team" | "queue">("team");
  const [assistantFilter, setAssistantFilter] = useState<string | null>(null);
  /** 待签批 / 待补充 / 待批准：刷新后默认展开非空组；手折写入 localStorage。 */
  const [userCollapsedGroups, setUserCollapsedGroups] = useState(() =>
    readFleetCollapsedGroups(),
  );
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
  const [deskAcceptanceReady, setDeskAcceptanceReady] = useState(true);
  const [deskDraftReviewStatus, setDeskDraftReviewStatus] = useState<
    "pending" | "approved" | "rejected" | "modified" | undefined
  >(undefined);
  const [postApproveExport, setPostApproveExport] = useState<PostApproveExportState | null>(null);
  const [trackedExportBusy, setTrackedExportBusy] = useState(false);
  const [saveAutomationBusy, setSaveAutomationBusy] = useState(false);
  const [saveAutomationHint, setSaveAutomationHint] = useState<string | null>(null);

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
        const [f, s, ov] = await Promise.all([
          loadAgentFleet(apiBase, null, { windowDays: 30 }),
          loadActionSummary(apiBase),
          apiGetJson<{
            ok?: boolean;
            overviews?: Array<{ matterId: string; displayName?: string; title?: string }>;
          }>(apiBase, "/api/matters/overviews").catch(() => null),
        ]);
        setFleet(f);
        setSummary(s);
        if (ov?.overviews?.length) {
          const labels: Record<string, string> = {};
          for (const row of ov.overviews) {
            const id = row.matterId?.trim();
            if (!id) {
              continue;
            }
            const title = row.displayName?.trim() || row.title?.trim();
            if (title) {
              labels[id] = title;
            }
          }
          setMatterLabelById(labels);
        }
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

  const allQueue = useMemo(
    () =>
      mergeFleetQueueRows({
        fleetRuns: fleet?.runs,
        pendingReviewDrafts: summary?.pendingReviewDrafts,
        automationInbox: summary?.automationInbox,
        snoozed,
        includePendingReview: requireSignoffReview,
      }),
    [fleet?.runs, summary?.pendingReviewDrafts, summary?.automationInbox, snoozed, requireSignoffReview],
  );

  const matterChoices = useMemo(() => {
    const ids = new Set<string>();
    for (const run of allQueue) {
      const mid = run.matterId?.trim();
      if (mid) {
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

  useEffect(() => {
    const next = defaultExpandedFleetGroups(queueGroups);
    for (const kind of userCollapsedGroups) {
      next.delete(kind);
    }
    setExpandedGroups(next);
  }, [queueGroups, userCollapsedGroups]);

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
    const next = resolveFleetSelectedId(queue, selectedId);
    if (next !== selectedId) {
      setSelectedId(next);
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
    const taskId = current?.taskId?.trim();
    if (!taskId) {
      return;
    }
    const persisted = readPersistedPostApproveExport(taskId);
    if (persisted) {
      setPostApproveExport(persisted);
    }
  }, [current?.taskId]);

  useEffect(() => {
    if (postApproveExport) {
      persistPostApproveExport(postApproveExport);
    }
  }, [postApproveExport]);

  useEffect(() => {
    setClarificationDraft({});
  }, [selectedId]);

  useEffect(() => {
    const taskId = current?.status === "awaiting_review" ? current.taskId?.trim() : "";
    if (!apiBase || !taskId) {
      setDeskChecklistView(null);
      setDeskChecklistChecked({});
      setDeskChecklistLoading(false);
      setDeskAcceptanceReady(true);
      setDeskDraftReviewStatus(undefined);
      return;
    }
    let cancelled = false;
    // 切换任务时先清空本地勾选，避免串到上一份草稿
    setDeskChecklistView(null);
    setDeskChecklistChecked({});
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
        setDeskAcceptanceReady(draft ? validateDraftAgainstSpec(draft).ready : true);
        const rs = draft?.reviewStatus;
        setDeskDraftReviewStatus(
          rs === "pending" || rs === "approved" || rs === "rejected" || rs === "modified"
            ? rs
            : "pending",
        );
      } catch {
        if (!cancelled) {
          const view = buildChecklistView(undefined, null);
          setDeskChecklistView(view);
          setDeskChecklistChecked({ ...view.state.checked });
          setDeskAcceptanceReady(true);
          setDeskDraftReviewStatus("pending");
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
        setUserCollapsedGroups((collapsed) => persistFleetCollapsedGroups(new Set(collapsed).add(kind)));
      } else {
        next.add(kind);
        setUserCollapsedGroups((collapsed) => {
          const copy = new Set(collapsed);
          copy.delete(kind);
          return persistFleetCollapsedGroups(copy);
        });
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
      // 与待拍板直觉一致：优先小 priority 值（0=最高），同优先级按更新时间新到旧。
      const next =
        [...rest].toSorted(
          (a, b) =>
            (a.priority ?? 9) - (b.priority ?? 9) ||
            (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
        )[0] ?? null;
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

  // 清单未加载时视为未完成（勿把 null view 当成 complete，否则一键勾选会被误禁用）
  const deskChecklistComplete = Boolean(
    deskChecklistView &&
      deskChecklistView.spec.items
        .filter((i) => i.required)
        .every((i) => deskChecklistChecked[i.id]),
  );

  // useMemo 化：仪式动作工厂不再每 render 重建（闭包引用最新输入，行为不变）。
  const {
    approveTool,
    approveToolEdit,
    rejectTool,
    respondClarify,
    resolveMatter,
    submitDraftReview,
    discardPendingDraft,
    runPostApproveExport,
    runPostApproveTrackedExport,
    saveAsAutomation,
  } = useMemo(
    () =>
      createFleetCeremonyActions({
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
        expectedReviewStatus: deskDraftReviewStatus,
      }),
    [
      advanceAfter,
      apiBase,
      clarificationDraft,
      current,
      deskChecklistChecked,
      deskChecklistComplete,
      deskDraftReviewStatus,
      onChatResumeComplete,
      onOpenReview,
      onShowArtifact,
      postApproveExport,
      refresh,
      sessionId,
    ],
  );

  const clarifyAction =
    current?.status === "awaiting_clarification"
      ? (pickFleetActionForRun(allActions, current) ??
        allActions.find((a) => a.kind === "clarification") ??
        allActions[0] ??
        null)
      : null;

  const isAutomationSend =
    current?.kind === "automation_send" || Boolean(current?.id.startsWith("automation-send:"));
  const isAutomationInbox = Boolean(current?.id.startsWith("automation-inbox:"));
  const approvalAction =
    current?.status === "awaiting_approval"
      ? (pickFleetActionForRun(allActions, current) ??
        allActions.find((a) => a.kind === "tool_approval" || a.kind === "continue_tools") ??
        allActions[0] ??
        null)
      : null;
  const approvalDock = fleetApprovalDockLabels(approvalAction?.kind);
  const primaryLabel = isDraftReview
    ? "通过"
    : current?.status === "awaiting_clarification"
      ? "提交补充并继续"
      : isAutomationSend
        ? "批准发送"
        : isAutomationInbox
          ? current?.taskId
            ? "改稿"
            : "已知悉"
          : current?.status === "awaiting_approval"
            ? approvalDock.primary
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

  const approveAutomationSend = useCallback(async () => {
    const run = current;
    const inboxId = run?.queueItemId?.trim();
    if (!run || !inboxId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSendJson(
        apiBase,
        `/api/automations/inbox/${encodeURIComponent(inboxId)}/action`,
        "POST",
        { action: "approve_send" },
      );
      onRefreshSummary?.();
      await refresh();
      advanceAfter(run.id);
    } catch (e) {
      setError(errorMessage(e, "批准发送失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, advanceAfter, busy, current, onRefreshSummary, refresh]);

  const acknowledgeAutomationInbox = useCallback(async () => {
    const run = current;
    const inboxId = run?.queueItemId?.trim();
    if (!run || !inboxId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSendJson(
        apiBase,
        `/api/automations/inbox/${encodeURIComponent(inboxId)}/action`,
        "POST",
        { action: "acknowledge" },
      );
      onRefreshSummary?.();
      await refresh();
      advanceAfter(run.id);
    } catch (e) {
      setError(errorMessage(e, "标记已知悉失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, advanceAfter, busy, current, onRefreshSummary, refresh]);

  const runPrimary = () => {
    if (!current || busy) {
      return;
    }
    if (isAutomationSend) {
      void approveAutomationSend();
      return;
    }
    if (isAutomationInbox) {
      if (current.taskId && onOpenReview) {
        onOpenReview(current.taskId, current.matterId);
        return;
      }
      void acknowledgeAutomationInbox();
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
      // 优先批准当前行绑定的动作（actionId/approvalId），避免多票并存时批错；
      // 无绑定时才回退池内首个。
      const bound = pickFleetActionForRun(allActions, current);
      const target = bound ?? allActions[0];
      if (target?.kind === "matter_approval") {
        void resolveMatter(target, "approved");
        return;
      }
      if (target) {
        void approveTool(target);
        return;
      }
    }
    if (current.sessionId) {
      onOpenChatSession(current.sessionId, current.matterId, current.assistantId);
    }
  };

  const showForm =
    current != null &&
    !isAutomationSend &&
    !isAutomationInbox &&
    (current.status === "awaiting_approval" || current.status === "awaiting_clarification") &&
    allActions.length > 0;

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
      : current.kind === "automation_send" && current.subtitle
        ? `${sanitizeLawyerFacingText(current.title, current.toolName)} · ${current.subtitle}`
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
        <p className="lm-meta lm-agents-wb-loading">加载中…</p>
      ) : null}

      {hasLoaded && allQueue.length === 0 && teamRows.length === 0 ? (
        <LawmindAgentFleetEmpty
          kind="decision"
          onOpenChat={() => onOpenChatSession(sessionId?.trim() || "")}
          onOpenReview={() => onOpenReview?.()}
        />
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
            matterLabelById={matterLabelById}
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
            matterLabelById={matterLabelById}
            assistantDisplayById={assistantDisplayById}
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
            deskAcceptanceReady={deskAcceptanceReady}
            onDeskChecklistCheckedChange={setDeskChecklistChecked}
            onClearError={() => setError(null)}
            busy={busy}
            primaryLabel={primaryLabel}
            rejectLabel={approvalDock.secondary}
            primaryDisabled={primaryDisabled}
            clarifyComplete={clarifyComplete}
            onPrimary={runPrimary}
            onDraftReview={(status) => void submitDraftReview(status)}
            onDiscardPendingDraft={() => void discardPendingDraft()}
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
              setSnoozed((prev) => persistFleetSnoozed(new Set(prev).add(current.id)));
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
            onPostApproveTrackedExport={() => {
              void (async () => {
                setTrackedExportBusy(true);
                try {
                  const r = await runPostApproveTrackedExport();
                  if (!r.ok && r.message) {
                    setError(r.message);
                  }
                } finally {
                  setTrackedExportBusy(false);
                }
              })();
            }}
            trackedExportBusy={trackedExportBusy}
            onPostApproveDismiss={() => {
              if (postApproveExport?.taskId) {
                clearPersistedPostApproveExport(postApproveExport.taskId);
              }
              setPostApproveExport(null);
            }}
            onShowArtifact={onShowArtifact}
            onOpenError={(message) => setError(message)}
            onOpenHealth={onOpenHealth}
            onSaveAsAutomation={
              postApproveExport?.matterId?.trim() || current?.matterId?.trim()
                ? () => {
                    void (async () => {
                      setSaveAutomationBusy(true);
                      setSaveAutomationHint(null);
                      try {
                        const r = await saveAsAutomation();
                        setSaveAutomationHint(r.message);
                        if (!r.ok) {
                          setError(r.message);
                        }
                      } finally {
                        setSaveAutomationBusy(false);
                      }
                    })();
                  }
                : undefined
            }
            saveAsAutomationBusy={saveAutomationBusy}
            saveAsAutomationHint={saveAutomationHint}
          />
        </div>
      ) : null}
    </div>
  );
}

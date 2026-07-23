/**
 * 在办 — 与对话工作台同构：左侧待办目录 · 右侧办理区。
 * 职责：集中处理签批 / 补充 / 批准（含待审文书的通过·驳回·需修改，无需全文预览）；
 * 改稿与交付预览去「文书台」。
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
import {
  appendEncodedLine,
  CLARIFY_ATTACHMENTS_KEY,
  CLARIFY_SESSIONS_KEY,
  clarificationAnswersComplete,
  encodeClarificationFileAnswer,
  encodeClarificationSessionRef,
} from "../../../../src/lawmind/platform/clarification-fields.ts";
import { LawmindRequiresActionCard } from "./LawmindRequiresActionCard";
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
import { apiGetJson, apiSendJson, errorMessage, messageFromOkFalseBody } from "./api-client";
import { apiPostDraftReview } from "./lawmind-api-routes";
import {
  buildChecklistView,
  checkAllRequiredChecklistItems,
  type VerificationChecklistView,
} from "../../../../src/lawmind/deliverables/verification-checklist.ts";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { LawmindVerificationChecklist } from "./LawmindVerificationChecklist";
import {
  createPostApproveExport,
  markPostApproveError,
  markPostApproveExporting,
  markPostApproveOk,
  type PostApproveExportState,
} from "./lawmind-post-approve-export";
import { toWorkspaceRelativePath } from "./lawmind-workspace-relpath";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";
import {
  extractApprovalDocumentPreview,
  toolArgsAreDocumentWrite,
  toolArgsHaveLawyerEditableShortFields,
  toolArgsLinkedTaskId,
} from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import { LawmindApprovalDocReader } from "./LawmindApprovalDocReader";
import { LawmindToolArgsEditDialog } from "./LawmindToolArgsEditDialog";
import {
  buildFleetTeamRows,
  filterRunsByAssistant,
  fleetTeamBusyLabel,
} from "./lawmind-fleet-team";

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

const FLEET_GROUP_ORDER = ["review", "clarify", "approve"] as const;

function fleetGroupLabel(kind: (typeof FLEET_GROUP_ORDER)[number]): string {
  switch (kind) {
    case "review":
      return "待签批";
    case "clarify":
      return "待补充";
    case "approve":
      return "待批准";
  }
}

function groupFleetQueue(
  runs: AgentRunSummary[],
): Array<{ kind: (typeof FLEET_GROUP_ORDER)[number]; label: string; items: AgentRunSummary[] }> {
  const buckets: Record<(typeof FLEET_GROUP_ORDER)[number], AgentRunSummary[]> = {
    review: [],
    clarify: [],
    approve: [],
  };
  for (const run of runs) {
    buckets[statusKind(run.status)].push(run);
  }
  return FLEET_GROUP_ORDER.map((kind) => ({
    kind,
    label: fleetGroupLabel(kind),
    items: buckets[kind],
  })).filter((g) => g.items.length > 0);
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

  const respondClarify = async (
    action: LawMindRequiresAction,
    answersOverride?: Record<string, string>,
  ) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      setError("缺少会话，无法提交补充。请从对话进入该任务后再试。");
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
          answersOverride ?? clarificationDraft,
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

  const isDraftReview = current?.status === "awaiting_review";

  const deskChecklistComplete =
    !deskChecklistView ||
    deskChecklistView.spec.items
      .filter((i) => i.required)
      .every((i) => deskChecklistChecked[i.id]);

  const submitDraftReview = async (status: "approved" | "rejected" | "modified") => {
    const taskId = current?.taskId?.trim();
    if (!taskId) {
      setError("缺少草稿任务，请先打开文书台。");
      return;
    }
    if (status === "approved" && !deskChecklistComplete) {
      setError("律师必核未齐：请勾选下方必核项，或点「一键勾选必核」后再通过。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    setError(null);
    try {
      const j = await apiPostDraftReview(apiBase, taskId, {
        status,
        ...(status === "approved" ? { checklistChecked: deskChecklistChecked } : {}),
      });
      if (!j.ok) {
        const code = typeof j.error === "string" ? j.error : "";
        if (code === "checklist_incomplete") {
          setError("律师必核未齐：请勾选下方必核项，或点「一键勾选必核」后再通过。");
          return;
        }
        throw new Error(messageFromOkFalseBody(j, "签批失败"));
      }
      await refresh();
      if (status === "approved") {
        setPostApproveExport(
          createPostApproveExport({
            taskId,
            matterId: current?.matterId,
            title: current?.title,
          }),
        );
      }
      advanceAfter(doneId);
      if (status === "modified" && onOpenReview) {
        onOpenReview(taskId, current?.matterId);
      }
    } catch (e) {
      setError(errorMessage(e, "签批失败"));
    } finally {
      setBusy(false);
    }
  };

  const runPostApproveExport = async () => {
    if (!apiBase || !postApproveExport?.taskId) {
      return;
    }
    setPostApproveExport((s) => (s ? markPostApproveExporting(s) : s));
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string; message?: string; outputPath?: string },
        Record<string, never>
      >(apiBase, `/api/drafts/${encodeURIComponent(postApproveExport.taskId)}/render`, "POST", {});
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, j.message || "导出失败"));
      }
      const out = j.outputPath?.trim() ?? "";
      setPostApproveExport((s) => (s ? markPostApproveOk(s, out) : s));
      if (out && onShowArtifact) {
        onShowArtifact(out);
      } else if (out && typeof window !== "undefined") {
        void window.lawmindDesktop?.showItemInFolder?.(out);
      }
    } catch (e) {
      setPostApproveExport((s) =>
        s ? markPostApproveError(s, errorMessage(e, "导出失败")) : s,
      );
    }
  };

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
        <div className="lm-agents-wb-empty" data-testid="lm-fleet-decision-empty">
          <h2>团队暂无在办</h2>
          <p>
            这里是领导视图：谁在忙、谁卡在补充/签批会列在左侧。新任务请到顶栏「对话」下达。
          </p>
          <div className="lm-agents-wb-empty-actions">
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

      {hasLoaded && allQueue.length > 0 && matterScopedQueue.length === 0 ? (
        <div className="lm-agents-wb-empty" data-testid="lm-fleet-filter-empty">
          <h2>本案暂无待办</h2>
          <p>当前案件筛选下没有待拍板项。可切换「全部案件」查看全所队列。</p>
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            onClick={() => setMatterFilter("all")}
          >
            查看全部案件
          </button>
        </div>
      ) : null}

      {showTeamWorkbench ? (
        <div className="lm-agents-wb-split">
          <aside className="lm-agents-wb-list" aria-label="在办团队目录">
            <div className="lm-agents-wb-list-toolbar">
              <span
                className="lm-agents-wb-pill"
                data-tone="warn"
                data-testid="lm-fleet-decision-focus-lead"
                title="当前筛选下待您拍板的事项数"
              >
                待拍板 {matterScopedQueue.length}
                {assistantFilter
                  ? ` · 筛选 ${queue.length}`
                  : matterFilter !== "all" && allQueue.length !== matterScopedQueue.length
                    ? ` / 全所 ${allQueue.length}`
                    : ""}
              </span>
              {matterChoices.length > 0 ? (
                <label className="lm-agents-wb-matter-filter">
                  <span className="lm-sr-only">按案件筛选</span>
                  <select
                    className="lm-input lm-agents-wb-matter-select"
                    data-testid="lm-fleet-matter-filter"
                    value={matterFilter}
                    onChange={(e) => setMatterFilter(e.target.value)}
                  >
                    <option value="all">全部案件</option>
                    {matterChoices.map((mid) => (
                      <option key={mid} value={mid}>
                        {mid}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {pendingTeachCount > 0 ? (
                onOpenMemoryInspector ? (
                  <button
                    type="button"
                    className="lm-agents-wb-pill lm-agents-wb-pill-btn"
                    data-tone="info"
                    data-testid="lm-fleet-pending-teach"
                    title="打开设置→记忆，确认团队学习建议"
                    onClick={() => onOpenMemoryInspector()}
                  >
                    待教 {pendingTeachCount}
                  </button>
                ) : (
                  <span
                    className="lm-agents-wb-pill"
                    data-tone="info"
                    data-testid="lm-fleet-pending-teach"
                    title="记忆采纳队列中待确认的团队学习建议"
                  >
                    待教 {pendingTeachCount}
                  </span>
                )
              ) : null}
              {needsDecisionFocus && onClearNeedsDecisionFocus ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  data-testid="lm-fleet-show-all"
                  onClick={() => onClearNeedsDecisionFocus()}
                >
                  退出聚焦
                </button>
              ) : null}
            </div>
            <div className="lm-agents-wb-list-modes" role="tablist" aria-label="目录视图">
              <button
                type="button"
                role="tab"
                className="lm-agents-wb-list-mode"
                aria-selected={listMode === "team"}
                data-testid="lm-fleet-mode-team"
                onClick={() => setListMode("team")}
              >
                团队
              </button>
              <button
                type="button"
                role="tab"
                className="lm-agents-wb-list-mode"
                aria-selected={listMode === "queue"}
                data-testid="lm-fleet-mode-queue"
                onClick={() => {
                  setListMode("queue");
                  setAssistantFilter(null);
                }}
              >
                队列
              </button>
            </div>
            <div className="lm-agents-wb-list-scroll">
              {listMode === "team" ? (
                <>
                  <button
                    type="button"
                    className="lm-agents-wb-team-row lm-agents-wb-team-row--all"
                    data-testid="lm-fleet-team-all"
                    aria-selected={assistantFilter === null}
                    onClick={() => {
                      setAssistantFilter(null);
                      setSelectedId(null);
                    }}
                  >
                    <span className="lm-agents-wb-team-name">全部成员</span>
                    <span className="lm-agents-wb-team-meta">
                      待拍板 {matterScopedQueue.length}
                    </span>
                  </button>
                  {teamRows.map((row) => {
                    const selected = assistantFilter === row.assistantId;
                    const pass =
                      row.windowTasksReviewed && row.windowTasksReviewed > 0 && row.windowFirstPassRate != null
                        ? `${Math.round(row.windowFirstPassRate * 100)}%`
                        : null;
                    return (
                      <button
                        key={row.assistantId}
                        type="button"
                        className="lm-agents-wb-team-row"
                        data-busy={row.busy}
                        data-testid={`lm-fleet-team-${row.assistantId}`}
                        aria-selected={selected}
                        onClick={() => {
                          setAssistantFilter(row.assistantId);
                          setListMode("team");
                          const theirs = filterRunsByAssistant(matterScopedQueue, row.assistantId);
                          if (theirs[0]) {
                            const kind = statusKind(theirs[0].status);
                            setExpandedGroups(new Set([kind]));
                            setSelectedId(theirs[0].id);
                          } else {
                            setSelectedId(null);
                          }
                        }}
                      >
                        <span className="lm-agents-wb-team-name">{row.displayName}</span>
                        <span className="lm-agents-wb-team-status" data-busy={row.busy}>
                          {fleetTeamBusyLabel(row.busy)}
                          {row.awaitingCount > 0 ? ` ${row.awaitingCount}` : ""}
                        </span>
                        <span className="lm-agents-wb-team-meta">
                          {pass ? `近30日一次过 ${pass}` : row.roleId ?? "—"}
                          {typeof row.avgRewriteAbsChars === "number"
                            ? ` · 均改写 ~${row.avgRewriteAbsChars} 字`
                            : ""}
                          {row.pendingAdoptions > 0 ? ` · 待教 ${row.pendingAdoptions}` : ""}
                        </span>
                        {row.currentTitle ? (
                          <span className="lm-agents-wb-team-title">
                            {sanitizeLawyerFacingText(row.currentTitle).slice(0, 48)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {assistantFilter && queue.length > 0 ? (
                    <div className="lm-agents-wb-team-drill" data-testid="lm-fleet-team-drill">
                      <div className="lm-agents-wb-team-drill-label">该成员待办</div>
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
                            data-fleet-run-id={run.id}
                            aria-selected={run.id === current?.id}
                            data-testid={`lm-agent-fleet-card-${run.kind}`}
                            onClick={() => setSelectedId(run.id)}
                          >
                            <span className="lm-agents-wb-row-kind" data-kind={kind}>
                              {statusLabel(run.status).replace(/^待/, "")}
                            </span>
                            <span className="lm-agents-wb-row-body">
                              <span className="lm-agents-wb-row-title">{rowTitle}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                queueGroups.map((group) => {
                  const expanded = expandedGroups.has(group.kind);
                  const panelId = `lm-fleet-group-panel-${group.kind}`;
                  return (
                    <div
                      key={group.kind}
                      className={`lm-agents-wb-group${expanded ? " lm-agents-wb-group--open" : ""}`}
                      data-kind={group.kind}
                      data-testid={`lm-fleet-group-${group.kind}`}
                    >
                      <button
                        type="button"
                        className="lm-agents-wb-group-toggle"
                        data-kind={group.kind}
                        data-testid={`lm-fleet-group-toggle-${group.kind}`}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        title={expanded ? `收起${group.label}` : `展开${group.label}`}
                        onClick={() => toggleGroup(group.kind)}
                      >
                        <span className="lm-agents-wb-group-label-text">{group.label}</span>
                        <span className="lm-agents-wb-group-count" aria-label={`${group.items.length} 件`}>
                          {group.items.length}
                        </span>
                        <span className="lm-agents-wb-group-chevron" aria-hidden />
                      </button>
                      {expanded ? (
                        <div
                          id={panelId}
                          className="lm-agents-wb-group-panel"
                          role="region"
                          aria-label={group.label}
                        >
                          {group.items.map((run) => {
                            const kind = statusKind(run.status);
                            const rowTitle = sanitizeLawyerFacingText(run.title, run.toolName)
                              .replace(/^待审定：\s*/, "")
                              .replace(/^待批准：\s*/, "");
                            const matterLine = run.matterId?.trim();
                            return (
                              <button
                                key={run.id}
                                type="button"
                                className="lm-agents-wb-row"
                                data-kind={kind}
                                data-fleet-run-id={run.id}
                                aria-selected={run.id === current?.id}
                                aria-label={`${statusLabel(run.status)} ${rowTitle}`}
                                data-testid={`lm-agent-fleet-card-${run.kind}`}
                                onClick={() => setSelectedId(run.id)}
                              >
                                <span className="lm-agents-wb-row-kind" data-kind={kind}>
                                  {statusLabel(run.status).replace(/^待/, "")}
                                </span>
                                <span className="lm-agents-wb-row-body">
                                  <span className="lm-agents-wb-row-title">{rowTitle}</span>
                                  {matterLine && !matterLine.startsWith("临时") ? (
                                    <span className="lm-agents-wb-row-matter">{matterLine}</span>
                                  ) : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <section
            className={`lm-agents-wb-detail${readingMode ? " lm-agents-wb-detail--reading" : ""}`}
            aria-label="办理区"
          >
            {!current ? (
              <div className="lm-agents-wb-detail-empty" data-testid="lm-fleet-pick-hint">
                <h2>{listMode === "team" ? "先看谁在忙" : "请选择要办理的事项"}</h2>
                <p>
                  {listMode === "team"
                    ? "左侧点选一位助手，查看其待拍板事项；也可切换「队列」按签批/补充/批准筛选。"
                    : "左侧展开「待签批 / 待补充 / 待批准」任一分组，再点选一条即可办理。"}
                </p>
              </div>
            ) : (
              <>
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
                <div
                  className={`lm-agents-wb-detail-inner${
                    current.status === "awaiting_clarification"
                      ? " lm-agents-wb-detail-inner--form"
                      : ""
                  }`}
                >
                  {isDraftReview ? (
                    <div className="lm-agents-wb-block" id="lm-fleet-panel-actions">
                      <p className="lm-meta" data-testid="lm-fleet-draft-hint">
                        待签批文书可在此直接通过 / 驳回 / 需修改。勾选必核后即可通过；需要改稿或核对交付样式时，再「进入文书台」。
                      </p>
                      {deskChecklistLoading ? (
                        <p className="lm-meta" aria-busy="true">
                          加载必核清单…
                        </p>
                      ) : deskChecklistView ? (
                        <div className="lm-fleet-desk-checklist" data-testid="lm-fleet-desk-checklist">
                          <div className="lm-fleet-desk-checklist-actions">
                            <button
                              type="button"
                              className="lm-btn lm-btn-secondary lm-btn-sm"
                              data-testid="lm-fleet-checklist-check-all"
                              disabled={busy || deskChecklistComplete}
                              title="表示您已逐项核对；系统将勾选全部必核项"
                              onClick={() => {
                                if (!deskChecklistView) {
                                  return;
                                }
                                setDeskChecklistChecked(
                                  checkAllRequiredChecklistItems(
                                    deskChecklistView,
                                    deskChecklistChecked,
                                  ),
                                );
                                setError(null);
                              }}
                            >
                              一键勾选必核
                            </button>
                            <span className="lm-meta">表示您已核对对应要点</span>
                          </div>
                          <LawmindVerificationChecklist
                            view={deskChecklistView}
                            checked={deskChecklistChecked}
                            onToggle={(id, value) =>
                              setDeskChecklistChecked((prev) => ({ ...prev, [id]: value }))
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : showForm ? (
                    <div
                      className={`lm-agents-wb-block${
                        current.status === "awaiting_clarification"
                          ? " lm-agents-wb-block--form"
                          : ""
                      }`}
                      id="lm-fleet-panel-actions"
                    >
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
                        onOpenReview={onOpenReview}
                        busy={busy}
                        hideActions
                        clarificationVariant="desk"
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
                data-testid={isDraftReview ? "lm-fleet-draft-approve" : "lm-ceremony-primary"}
                disabled={primaryDisabled}
                title={
                  current.status === "awaiting_clarification" && !clarifyComplete
                    ? "请先填完必填项"
                    : isDraftReview && !deskChecklistComplete
                      ? "请先完成律师必核清单"
                      : undefined
                }
                onClick={runPrimary}
              >
                {primaryLabel}
              </button>
              {isDraftReview ? (
                <>
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary"
                    disabled={busy}
                    data-testid="lm-fleet-draft-reject"
                    onClick={() => void submitDraftReview("rejected")}
                  >
                    驳回
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary"
                    disabled={busy}
                    data-testid="lm-fleet-draft-modify"
                    onClick={() => void submitDraftReview("modified")}
                    title="标为需修改后进入文书台改稿或派发助手修订"
                  >
                    需修改
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost"
                    data-testid="lm-fleet-primary-review"
                    disabled={busy}
                    onClick={() => onOpenReview?.(current.taskId, current.matterId)}
                    title="改稿、批注与交付预览；正式批复仍在本页"
                  >
                    进入文书台
                  </button>
                </>
              ) : current.status === "awaiting_approval" && approvalAction ? (
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
              approvalAction?.kind === "tool_approval" &&
              approvalIsDocWrite &&
              approvalLinkedTaskId &&
              onOpenReview ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost"
                  disabled={busy}
                  data-testid="lm-fleet-approval-open-review"
                  onClick={() => onOpenReview(approvalLinkedTaskId, current.matterId)}
                  title="全文改稿与交付预览在文书台；此处仅批准或驳回写入"
                >
                  进入文书台
                </button>
              ) : null}
              {current.status === "awaiting_approval" && showArgsEdit ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost"
                  disabled={busy}
                  data-testid="lm-ceremony-edit-args"
                  onClick={() => {
                    setArgsEditError(null);
                    setArgsEditOpen(true);
                  }}
                  title={
                    approvalIsDocWrite
                      ? "仅改标题等短字段；全文请用文书台"
                      : "调整短字段后批准"
                  }
                >
                  {approvalIsDocWrite ? "改参数…" : "改拟稿…"}
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
              matterId={current.matterId}
              onOpenReview={onOpenReview}
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
              </>
            )}

            {postApproveExport ? (
              <div
                className="lm-callout lm-callout-info lm-fleet-post-approve"
                role="status"
                data-testid="lm-fleet-post-approve"
              >
                <p className="lm-callout-title">已通过：{postApproveExport.title}</p>
                <p className="lm-callout-body">
                  {postApproveExport.status === "ok" && postApproveExport.outputPath
                    ? `已导出 ${postApproveExport.outputPath.split(/[\\/]/).pop()}`
                    : postApproveExport.status === "error"
                      ? postApproveExport.errorMessage
                      : "可直接导出 Word，或进入文书台核对后再导出。"}
                </p>
                <div className="lm-fleet-post-approve-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-accent lm-btn-sm"
                    data-testid="lm-fleet-post-approve-export"
                    disabled={postApproveExport.status === "exporting"}
                    onClick={() => void runPostApproveExport()}
                  >
                    {postApproveExport.status === "exporting"
                      ? "导出中…"
                      : postApproveExport.status === "ok"
                        ? "再次导出"
                        : "导出 Word"}
                  </button>
                  {onOpenReview ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-secondary lm-btn-sm"
                      data-testid="lm-fleet-post-approve-review"
                      onClick={() =>
                        onOpenReview(postApproveExport.taskId, postApproveExport.matterId)
                      }
                    >
                      去文书台
                    </button>
                  ) : null}
                  {postApproveExport.status === "ok" && postApproveExport.outputPath ? (
                    <>
                      {(() => {
                        const rel = toWorkspaceRelativePath(
                          workspaceDir,
                          postApproveExport.outputPath,
                        );
                        if (!rel || !window.lawmindDesktop?.openWithSystem) {
                          return null;
                        }
                        return (
                          <button
                            type="button"
                            className="lm-btn lm-btn-secondary lm-btn-sm"
                            data-testid="lm-fleet-post-approve-word"
                            title="用本机 Word / WPS 打开（不回写）"
                            onClick={() => {
                              void window.lawmindDesktop
                                ?.openWithSystem?.({ root: "workspace", path: rel })
                                .then((r) => {
                                  if (r && !r.ok) {
                                    setError(r.error ?? "无法用系统应用打开该文件");
                                  }
                                });
                            }}
                          >
                            用 Word 打开
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        onClick={() => {
                          const p = postApproveExport.outputPath!;
                          if (onShowArtifact) {
                            onShowArtifact(p);
                          } else if (typeof window !== "undefined") {
                            void window.lawmindDesktop?.showItemInFolder?.(p);
                          }
                        }}
                      >
                        文件夹
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    data-testid="lm-fleet-post-approve-dismiss"
                    onClick={() => setPostApproveExport(null)}
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

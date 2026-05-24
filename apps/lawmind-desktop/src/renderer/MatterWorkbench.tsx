/**
 * 案件工作台 — 列表、摘要、CASE 档案、任务/草稿/审计时间线、案件内搜索。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import { apiGetJson, apiSendJson, errorMessage, messageFromOkFalseBody } from "./api-client";
import { LM_PANE_MAX_WIDTH_PX, LM_PANE_MIN_WIDTH_PX } from "./lawmind-panel-layout";
import { usePaneResizePx } from "./use-pane-resize";
import { useEdition } from "./use-edition";
import type { HistoryItem, TaskRow as ShellTaskRow } from "./lawmind-app-data";
import { RECORDS_DESK_UNLINKED } from "./lawmind-records-desk-state";
import { LawmindMatterContextMenu } from "./LawmindMatterContextMenu";
import { LawmindCreateMatterDialog } from "./LawmindCreateMatterDialog";
import { MatterTeamMeetingPanel } from "./MatterTeamMeetingPanel";
import { MatterCasePanel } from "./matter/MatterCasePanel";
import { MatterTasksPanel } from "./matter/MatterTasksPanel";
import { MatterReviewMatrixPanel } from "./matter/MatterReviewMatrixPanel";
import {
  buildCaseFocusDraft,
  type CaseDraftVariant,
  type CaseFocusContext,
} from "./matter/matter-case-focus";
import { useMatterPanelTab, useMatterWorkspaceAcceptance } from "./matter/useMatterWorkbench";
import type { TaskBoardJobInput } from "./matter/matter-task-board";

export type MatterWorkbenchHandle = {
  openCreateMatter: () => void;
};

import {
  type AdoptionHistoryInsight,
  type AdoptedSuggestionRecord,
  type AuditEventRow,
  type MatterSearchHit,
  type PersistentAdoptionItem,
  type MatterCognitionBoard,
  type MatterConvergenceSuggestion,
  type MatterCrossExperimentRollupItem,
  type MatterInteractionSummary,
  type MatterProductAdaptationSuggestion,
  type MatterProductExperimentItem,
  type MatterRecommendationTarget,
  type MatterRoadmapCandidate,
  auditKindLabel,
  blockingNextAction,
  matterInteractionSurfaceLabel,
  memoryUpgradeRecommendation,
  parseMatterInteractionEvent,
  sectionWriteTarget,
} from "./matter/matter-interaction";
import { useMatterDetail } from "./matter/useMatterDetail";
import { MatterOverviewBody } from "./matter/MatterOverviewBody";
import { MatterCognitionPanel } from "./matter/MatterCognitionPanel";
import { MatterShellRecordsPanel } from "./matter/MatterShellRecordsPanel";
import { MatterWorkbenchTabs } from "./matter/MatterWorkbenchTabs";

type Props = {
  apiBase: string;
  refreshVersion?: number;
  assistantId?: string;
  /** 从审核台返回时由外壳一次性传入，用于恢复左侧选中的案件 */
  focusMatterId?: string | null;
  onFocusMatterIdApplied?: () => void;
  /** 在对话中带上案件 ID（matter 参数） */
  onUseInChat?: (matterId: string) => void;
  /** 从批准队列跳转到对应对话会话 */
  onOpenChatSession?: (sessionId: string, matterId?: string) => void;
  /** 打开审核台并预选相关草稿 */
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  /** workbench：列表在组件内；app-sidebar：列表在外壳左栏（与「工作台」材料树同轨） */
  matterListPlacement?: "workbench" | "app-sidebar";
  selectedMatterKey?: string | null;
  shellTasks?: ShellTaskRow[];
  shellHistory?: HistoryItem[];
  onOpenShellDetail?: (kind: "task" | "draft", id: string) => void;
  formatShellRelativeTime?: (iso: string) => string;
  shellAssistantDisplayById?: Record<string, string>;
  shellLegalStatusLabel?: (status: string | undefined, kind?: string) => string;
  shellTaskBadgeClass?: (status: string, kind?: string) => string;
  shellHistoryBadgeClass?: (kind: string, taskRecordKind?: string, status?: string) => string;
  /** 工作区根目录；用于从案件列表打开 cases/&lt;id&gt; 文件夹 */
  workspaceDir?: string | null;
  /** 项目目录；会议室对话可选传给检索 */
  projectDir?: string | null;
  onMatterCreated?: (matterId: string) => void;
  /** 打开协作页工作流库（任务看板空状态 CTA） */
  onOpenWorkflowLibrary?: () => void;
};


export const MatterWorkbench = forwardRef<MatterWorkbenchHandle, Props>(function MatterWorkbench(props, ref) {
  const {
    apiBase,
    refreshVersion = 0,
    assistantId,
    focusMatterId,
    onFocusMatterIdApplied,
    onUseInChat,
    onOpenChatSession,
    onOpenReview,
    matterListPlacement = "workbench",
    selectedMatterKey: selectedMatterKeyProp = null,
    shellTasks = [],
    shellHistory = [],
    onOpenShellDetail,
    formatShellRelativeTime,
    shellAssistantDisplayById = {},
    shellLegalStatusLabel,
    shellTaskBadgeClass,
    shellHistoryBadgeClass,
    onMatterCreated,
    onOpenWorkflowLibrary,
    workspaceDir = null,
    projectDir = null,
  } = props;
  const editionInfo = useEdition(apiBase);
  const showCrossMatterRoadmap = !editionInfo.loading && editionInfo.features.crossMatterRoadmap;
  const showWorkspaceAcceptanceDashboard =
    !editionInfo.loading && editionInfo.features.crossMatterAcceptanceDashboard;
  const { workspaceAcceptance, workspaceAcceptanceErr } = useMatterWorkspaceAcceptance(
    apiBase,
    showWorkspaceAcceptanceDashboard,
    refreshVersion,
  );

  const matterDetail = useMatterDetail({
    apiBase,
    refreshVersion,
    matterListPlacement,
    selectedMatterKey: selectedMatterKeyProp,
    focusMatterId,
    onFocusMatterIdApplied,
  });
  const {
    overviews,
    loadingList,
    listError,
    internalSelectedId,
    setInternalSelectedId,
    detailLoading,
    detailError,
    summary,
    caseMemory,
    caseTruncated,
    coreIssues,
    riskNotes,
    progressEntries,
    artifacts,
    tasks,
    drafts,
    approvalRequests,
    queueItems,
    draftCitationByTask,
    acceptanceByTask,
    auditEvents,
    setAuditEvents,
    opsFocus,
    setOpsFocus,
    opsSort,
    setOpsSort,
    searchQ,
    setSearchQ,
    searchHits,
    setSearchHits,
    searchBusy,
    setSearchBusy,
    isAppSidebar,
    navKey,
    matterId,
    loadList,
    loadDetail,
  } = matterDetail;

  const [searchIndexMissing, setSearchIndexMissing] = useState(false);
  const [cognitionReasoningReport, setCognitionReasoningReport] = useState<
    import("../../../../src/lawmind/deliverables/index.ts").ReasoningReport | null
  >(null);
  const [panelTab, setPanelTab] = useMatterPanelTab("overview");
  const selectedOverview = useMemo(
    () => (matterId ? (overviews.find((o) => o.matterId === matterId) ?? null) : null),
    [matterId, overviews],
  );
  const isUnlinkedBucket = isAppSidebar && selectedMatterKeyProp === RECORDS_DESK_UNLINKED;

  const [matterOverviewExtrasOpen, setMatterOverviewExtrasOpen] = useState(false);
  const [caseFocusContext, setCaseFocusContext] = useState<CaseFocusContext | null>(null);
  const [caseActionBusy, setCaseActionBusy] = useState(false);
  const [caseActionMsg, setCaseActionMsg] = useState<string | null>(null);
  const [caseDraftVariant, setCaseDraftVariant] = useState<CaseDraftVariant>("standard");
  const [caseDraftNote, setCaseDraftNote] = useState("");

  const [matterJobs, setMatterJobs] = useState<TaskBoardJobInput[]>([]);

  useEffect(() => {
    if (!apiBase || !matterId) {
      setMatterJobs([]);
      return;
    }
    let cancelled = false;
    void apiGetJson<{
      ok?: boolean;
      jobs?: Array<{
        jobId: string;
        workflowId: string;
        status: string;
        matterId?: string;
        createdAt: string;
        scheduledTrigger?: { runAt?: string };
      }>;
    }>(
      apiBase,
      `/api/jobs?limit=20&status=queued&status=running&status=scheduled&matterId=${encodeURIComponent(matterId)}`,
    )
      .then((j) => {
        if (cancelled) {
          return;
        }
        setMatterJobs(
          (j.jobs ?? []).map((job) => ({
            jobId: job.jobId,
            workflowId: job.workflowId,
            status: job.status,
            matterId: job.matterId,
            createdAt: job.createdAt,
            scheduledRunAt: job.scheduledTrigger?.runAt,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setMatterJobs([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId, refreshVersion]);

  const [sessionTimeline, setSessionTimeline] = useState<
    Array<{ id: string; timestamp: string; label: string; severity: string }>
  >([]);

  useEffect(() => {
    if (!apiBase || !matterId || panelTab !== "timeline") {
      return;
    }
    let cancelled = false;
    void apiGetJson<{
      ok?: boolean;
      entries?: Array<{ id: string; timestamp: string; label: string; severity: string }>;
    }>(apiBase, `/api/matters/session-timeline?matterId=${encodeURIComponent(matterId)}&limit=30`)
      .then((r) => {
        if (!cancelled) {
          setSessionTimeline(r.entries ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionTimeline([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId, panelTab, refreshVersion]);

  const [showCreate, setShowCreate] = useState(false);
  const [matterListCtx, setMatterListCtx] = useState<{ x: number; y: number; matterId: string } | null>(null);
  const [cognitionTaskId, setCognitionTaskId] = useState<string | null>(null);
  const [cognitionLoading, setCognitionLoading] = useState(false);
  const [cognitionError, setCognitionError] = useState<string | null>(null);
  const [cognitionReasoningMarkdown, setCognitionReasoningMarkdown] = useState<string | null>(null);
  const [cognitionMemorySources, setCognitionMemorySources] = useState<MemorySourceLayer[]>([]);
  const [cognitionBoardLoading, setCognitionBoardLoading] = useState(false);
  const [cognitionBoardError, setCognitionBoardError] = useState<string | null>(null);
  const [cognitionBoard, setCognitionBoard] = useState<MatterCognitionBoard | null>(null);
  const [cognitionActionBusy, setCognitionActionBusy] = useState<string | null>(null);
  const [cognitionActionMsg, setCognitionActionMsg] = useState<string | null>(null);
  const [crossExperimentRollup, setCrossExperimentRollup] = useState<MatterCrossExperimentRollupItem[]>([]);
  const [adoptedSuggestions, setAdoptedSuggestions] = useState<AdoptedSuggestionRecord[]>([]);
  const [persistentAdoptions, setPersistentAdoptions] = useState<AdoptedSuggestionRecord[]>([]);
  const hasHandledRefreshRef = useRef(false);
  const prevSelectedMatterForCognitionRef = useRef<string | null>(null);
  const coreIssuesRef = useRef<HTMLHeadingElement | null>(null);
  const riskNotesRef = useRef<HTMLHeadingElement | null>(null);
  const artifactsRef = useRef<HTMLHeadingElement | null>(null);
  const caseMdRef = useRef<HTMLHeadingElement | null>(null);

  useImperativeHandle(ref, () => ({
    openCreateMatter: () => {
      setShowCreate(true);
    },
  }));

  const shellTasksScoped = useMemo(() => {
    if (isUnlinkedBucket) {
      return shellTasks.filter((t) => !t.matterId?.trim());
    }
    if (!matterId) {
      return [];
    }
    return shellTasks.filter((t) => t.matterId?.trim() === matterId);
  }, [shellTasks, matterId, isUnlinkedBucket]);

  const shellHistoryScoped = useMemo(() => {
    if (isUnlinkedBucket) {
      return shellHistory.filter((h) => !h.matterId?.trim());
    }
    if (!matterId) {
      return [];
    }
    return shellHistory.filter((h) => h.matterId?.trim() === matterId);
  }, [shellHistory, matterId, isUnlinkedBucket]);

  const showShellOps = Boolean(
    onOpenShellDetail &&
      formatShellRelativeTime &&
      shellLegalStatusLabel &&
      shellTaskBadgeClass &&
      shellHistoryBadgeClass,
  );

  const prevNavKeyRef = useRef<string | null>(null);

  const { width: workbenchListWidth, onResizePointerDown: onMatterListResize } = usePaneResizePx({
    storageKey: "lawmind.ui.matterWorkbenchListWidth",
    defaultWidth: 260,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
  });

  const pendingDrafts = drafts.filter((draft) => draft.reviewStatus === "pending");
  const modifiedDrafts = drafts.filter((draft) => draft.reviewStatus === "modified");
  const approvedDrafts = drafts.filter((draft) => draft.reviewStatus === "approved");
  const elevatedApprovals = approvalRequests.filter(
    (item) => item.status === "pending" && (item.riskLevel === "medium" || item.riskLevel === "high"),
  );
  const cognitionDefaultTaskId =
    pendingDrafts[0]?.taskId ??
    modifiedDrafts[0]?.taskId ??
    approvedDrafts[0]?.taskId ??
    drafts[0]?.taskId ??
    null;
  const cognitionBoardDrafts = useMemo(() => {
    const pending = drafts.filter((draft) => draft.reviewStatus === "pending");
    const modified = drafts.filter((draft) => draft.reviewStatus === "modified");
    const approved = drafts.filter((draft) => draft.reviewStatus === "approved");
    const ordered = [...pending, ...modified, ...approved, ...drafts];
    const seen = new Set<string>();
    return ordered.filter((draft) => {
      if (seen.has(draft.taskId)) {
        return false;
      }
      seen.add(draft.taskId);
      return true;
    }).slice(0, 6);
  }, [drafts]);

  const cognitionBoardCitationFingerprint = useMemo(
    () =>
      cognitionBoardDrafts
        .map((d) => {
          const c = draftCitationByTask[d.taskId];
          const ok = c && c.checked ? c.ok : false;
          return `${d.taskId}:${Boolean(c?.checked)}:${Boolean(ok)}`;
        })
        .join("|"),
    [cognitionBoardDrafts, draftCitationByTask],
  );

  const filteredQueueItems = useMemo(() => {
    const filtered = queueItems.filter((item) => {
      switch (opsFocus) {
        case "review":
          return item.kind === "need_lawyer_review" || item.kind === "need_partner_approval";
        case "modified":
          return item.kind === "need_lawyer_review" && (item.detail?.includes("修改") ?? false);
        case "delivery":
          return item.kind === "ready_to_render";
        case "highRisk":
          return item.priority === "critical" || item.priority === "high";
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      if (opsSort === "recent") {
        return b.updatedAt.localeCompare(a.updatedAt);
      }
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
      return byPriority !== 0 ? byPriority : b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [opsFocus, opsSort, queueItems]);

  const filteredApprovalRequests = useMemo(() => {
    const filtered = approvalRequests.filter((item) => {
      switch (opsFocus) {
        case "review":
          return item.status === "pending";
        case "modified":
          return item.status === "needs_changes";
        case "delivery":
          return item.status === "approved";
        case "highRisk":
          return item.status === "pending" && (item.riskLevel === "medium" || item.riskLevel === "high");
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.reason.localeCompare(b.reason, "zh-CN");
      }
      const riskOrder = { high: 0, medium: 1, low: 2 };
      if (opsSort === "priority") {
        const byRisk = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        return byRisk !== 0 ? byRisk : b.requestedAt.localeCompare(a.requestedAt);
      }
      return b.requestedAt.localeCompare(a.requestedAt);
    });
  }, [approvalRequests, opsFocus, opsSort]);

  const filteredDrafts = useMemo(() => {
    const filtered = drafts.filter((draft) => {
      switch (opsFocus) {
        case "review":
          return draft.reviewStatus === "pending";
        case "modified":
          return draft.reviewStatus === "modified";
        case "delivery":
          return draft.reviewStatus === "approved";
        case "highRisk":
          return elevatedApprovals.some((item) => item.deliverableId === draft.taskId);
        default:
          return true;
      }
    });
    return filtered.toSorted((a, b) => {
      if (opsSort === "title") {
        return a.title.localeCompare(b.title, "zh-CN");
      }
      if (opsSort === "recent") {
        return b.createdAt.localeCompare(a.createdAt);
      }
      const statusOrder = { pending: 0, modified: 1, approved: 2, rejected: 3 };
      const byStatus = statusOrder[a.reviewStatus] - statusOrder[b.reviewStatus];
      return byStatus !== 0 ? byStatus : b.createdAt.localeCompare(a.createdAt);
    });
  }, [drafts, elevatedApprovals, opsFocus, opsSort]);

  const reviewTargetForFocus = useMemo(() => {
    switch (opsFocus) {
      case "review":
        return { statusFilter: "pending" as const, listMode: "pending" as const };
      case "modified":
        return { statusFilter: "modified" as const, listMode: "all" as const };
      case "delivery":
        return { statusFilter: "approved" as const, listMode: "all" as const };
      case "highRisk":
        return { statusFilter: "all" as const, listMode: "all" as const };
      default:
        return { statusFilter: "all" as const, listMode: "all" as const };
    }
  }, [opsFocus]);

  const recentMatterInteractions = useMemo(
    () => auditEvents.filter((event) => event.kind === "ui.matter_action").slice(-5).reverse(),
    [auditEvents],
  );

  const matterInteractionSummary = useMemo<MatterInteractionSummary>(() => {
    const interactions = auditEvents
      .filter((event) => event.kind === "ui.matter_action")
      .map((event) => ({ event, parsed: parseMatterInteractionEvent(event) }));
    const surfaceCounts = new Map<string, number>();
    const labelCounts = new Map<string, number>();
    let reviewOpenCount = 0;
    let memorySaveCount = 0;
    let caseWriteCount = 0;
    for (const item of interactions) {
      if (item.parsed.action === "open_review") {
        reviewOpenCount += 1;
      } else if (item.parsed.action === "save_upgrade_suggestion") {
        memorySaveCount += 1;
      } else if (item.parsed.action === "write_case_note") {
        caseWriteCount += 1;
      }
      if (item.parsed.surface) {
        surfaceCounts.set(item.parsed.surface, (surfaceCounts.get(item.parsed.surface) ?? 0) + 1);
      }
      if (item.parsed.label) {
        labelCounts.set(item.parsed.label, (labelCounts.get(item.parsed.label) ?? 0) + 1);
      }
    }
    const dominantSurface = Array.from(surfaceCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))[0];
    const dominantAction =
      reviewOpenCount >= memorySaveCount && reviewOpenCount >= caseWriteCount
        ? "review"
        : memorySaveCount >= caseWriteCount
          ? "memory"
          : "case";
    const dominantActionLabel =
      dominantAction === "review" ? "审核往返最频繁" : dominantAction === "memory" ? "认知沉淀最活跃" : "CASE 补档最频繁";
    const dominantActionHint =
      dominantAction === "review"
        ? "律师最近更多是在审核台和案件页之间来回切换，说明草稿把关仍是当前主工作面。"
        : dominantAction === "memory"
          ? "律师最近更常把高频经验沉淀进长期记忆，说明认知升级机制开始被实际使用。"
          : "律师最近更常把阻塞信息写回案件档案，说明 CASE 正在成为推进案件的实际操作面。";
    return {
      total: interactions.length,
      latestAt: interactions
        .map((item) => item.event.timestamp)
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .toSorted((a, b) => a.localeCompare(b))
        .at(-1),
      reviewOpenCount,
      memorySaveCount,
      caseWriteCount,
      dominantSurface,
      dominantActionLabel,
      dominantActionHint,
      topLabels: Array.from(labelCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .filter((item) => item.count >= 2)
        .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
        .slice(0, 3),
    };
  }, [auditEvents]);

  const logMatterInteraction = useCallback(
    async (params: {
      action: "open_review" | "save_upgrade_suggestion" | "write_case_note";
      taskId?: string;
      surface: string;
      label: string;
      target?: "lawyer" | "assistant";
      variant?: CaseDraftVariant;
      section?: "core_issue" | "risk" | "artifact" | "task_goal";
    }) => {
      if (!matterId) {
        return;
      }
      try {
        const r = await fetch(`${apiBase}/api/matters/interaction`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            matterId: matterId,
            taskId: params.taskId,
            action: params.action,
            surface: params.surface,
            label: params.label,
            target: params.target,
            variant: params.variant,
            section: params.section,
          }),
        });
        const j = (await r.json()) as {
          ok?: boolean;
          event?: AuditEventRow;
        };
        if (r.ok && j.ok && j.event) {
          const event = j.event;
          setAuditEvents((prev) => [...prev, event].toSorted((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")));
        }
      } catch {
        /* interaction evidence is best effort */
      }
    },
    [apiBase, matterId],
  );

  const blockingExplanations = useMemo(() => {
    const explanations: Array<{
      key: string;
      title: string;
      tone: "warn" | "info" | "neutral";
      detail: string;
      count: number;
      nextAction: string;
      actionLabel: string;
      actionTaskId?: string;
      actionTab?: "case" | "tasks";
      caseFocusContext?: CaseFocusContext;
    }> = [];

    const reviewBlockers = queueItems.filter(
      (item) => item.kind === "need_lawyer_review" || item.kind === "need_partner_approval",
    );
    if (reviewBlockers.length > 0) {
      explanations.push({
        key: "review",
        title: "审核链路阻塞",
        tone: "warn",
        detail:
          reviewBlockers[0]?.detail ??
          "当前至少有草稿还在等待律师或上级确认，交付动作不应继续推进。",
        count: reviewBlockers.length,
        nextAction: blockingNextAction(reviewBlockers[0]?.kind ?? "need_lawyer_review"),
        actionLabel: "去审核",
        actionTaskId: reviewBlockers[0]?.relatedTaskId,
      });
    }

    const evidenceBlockers = queueItems.filter(
      (item) =>
        item.kind === "need_evidence" || item.kind === "need_client_input" || item.kind === "need_conflict_check",
    );
    if (evidenceBlockers.length > 0) {
      explanations.push({
        key: "evidence",
        title: "材料与事实阻塞",
        tone: "info",
        detail:
          evidenceBlockers[0]?.detail ??
          "当前案件仍缺关键事实、证据或冲突检查信息，推理与交付可信度不足。",
        count: evidenceBlockers.length,
        nextAction: blockingNextAction(evidenceBlockers[0]?.kind ?? "need_evidence"),
        actionLabel: "去 CASE 档案",
        actionTab: "case",
        caseFocusContext: {
          title: "材料与事实阻塞",
          hint: "建议先在 CASE 档案里补充事实缺口、证据线索或客户待答问题。",
          query: "证据",
          section: "risk-notes",
        },
      });
    }

    const strategyBlockers = queueItems.filter((item) => item.kind === "blocked_by_missing_strategy");
    if (strategyBlockers.length > 0) {
      explanations.push({
        key: "strategy",
        title: "策略尚未定型",
        tone: "neutral",
        detail:
          strategyBlockers[0]?.detail ??
          "案件还没有沉淀出稳定的核心争点和任务目标，后续执行会反复返工。",
        count: strategyBlockers.length,
        nextAction: blockingNextAction(strategyBlockers[0]?.kind ?? "blocked_by_missing_strategy"),
        actionLabel: "去 CASE 档案",
        actionTab: "case",
        caseFocusContext: {
          title: "策略尚未定型",
          hint: "建议先在 CASE 或 MATTER_STRATEGY 中补齐核心争点、目标和底线。",
          query: "策略",
          section: "core-issues",
        },
      });
    }

    const renderReady = queueItems.filter((item) => item.kind === "ready_to_render");
    if (renderReady.length > 0) {
      explanations.push({
        key: "delivery",
        title: "交付动作未完成",
        tone: "info",
        detail:
          renderReady[0]?.detail ??
          "已有审核通过的草稿，但最终渲染和交付动作尚未执行。",
        count: renderReady.length,
        nextAction: blockingNextAction(renderReady[0]?.kind ?? "ready_to_render"),
        actionLabel: "去审核",
        actionTaskId: renderReady[0]?.relatedTaskId,
      });
    }

    return explanations.slice(0, 4);
  }, [queueItems]);

  const convergenceSuggestions = useMemo<MatterConvergenceSuggestion[]>(() => {
    const suggestions: MatterConvergenceSuggestion[] = [];

    if (matterInteractionSummary.reviewOpenCount >= 3) {
      const targetDraft = pendingDrafts[0] ?? modifiedDrafts[0] ?? approvedDrafts[0] ?? drafts[0];
      suggestions.push({
        key: "review-loop",
        title: "审核入口仍是主工作面",
        detail:
          "当前案件多次从驾驶舱跳去审核，说明律师还在围绕草稿把关来回切换。可以继续把关键审核决策前置到案件概览。",
        actionLabel: targetDraft ? "打开当前审核焦点" : "等待草稿",
        tone: "warn",
        target: targetDraft
          ? {
              type: "review",
              taskId: targetDraft.taskId,
              sourceSurface: "behavior-summary",
              sourceLabel: "审核入口仍是主工作面",
              statusFilter: targetDraft.reviewStatus,
              listMode: targetDraft.reviewStatus === "pending" ? "pending" : "all",
            }
          : { type: "none" },
      });
    }

    if (matterInteractionSummary.caseWriteCount >= 2) {
      const blockerContext =
        blockingExplanations.find((item) => item.actionTab === "case")?.caseFocusContext ?? caseFocusContext ?? undefined;
      suggestions.push({
        key: "case-loop",
        title: "CASE 已成为推进主入口",
        detail:
          "律师反复把阻塞信息写回案件档案，说明当前更需要结构化案件记录，而不只是列表式提醒。优先把争点、风险和证据补齐会更高效。",
        actionLabel: "回到 CASE 焦点",
        tone: "info",
        target: { type: "case", context: blockerContext },
      });
    }

    if (matterInteractionSummary.memorySaveCount >= 2) {
      suggestions.push({
        key: "memory-loop",
        title: "高频经验值得前置沉淀",
        detail:
          "当前案件已经开始重复采纳认知升级建议，说明有一部分经验正在从单案技巧变成稳定规则，适合继续在认知页审视并提升为长期记忆。",
        actionLabel: "查看认知升级线索",
        tone: "success",
        target: { type: "cognition" },
      });
    }

    if (
      suggestions.length === 0 &&
      matterInteractionSummary.total > 0 &&
      matterInteractionSummary.dominantSurface &&
      matterInteractionSummary.dominantSurface.count >= 2
    ) {
      suggestions.push({
        key: "observe-pattern",
        title: "继续观察当前操作重心",
        detail: `当前最常进入的入口是 ${matterInteractionSurfaceLabel(
          matterInteractionSummary.dominantSurface.label,
        )}，建议继续积累 2-3 个案件样本后再决定是否做更激进的交互收敛。`,
        actionLabel: "暂无动作",
        tone: "neutral",
        target: { type: "none" },
      });
    }

    return suggestions.slice(0, 3);
  }, [
    approvedDrafts,
    blockingExplanations,
    caseFocusContext,
    drafts,
    matterInteractionSummary,
    modifiedDrafts,
    pendingDrafts,
  ]);

  const productAdaptationSuggestions = useMemo<MatterProductAdaptationSuggestion[]>(() => {
    const suggestions: MatterProductAdaptationSuggestion[] = [];

    if (matterInteractionSummary.reviewOpenCount >= 3) {
      const targetDraft = pendingDrafts[0] ?? modifiedDrafts[0] ?? approvedDrafts[0] ?? drafts[0];
      suggestions.push({
        key: "adapt-review-surface",
        title: "把审核决策前置到案件概览",
        detail:
          "当前案件多次从驾驶舱跳去审核，说明概览页还缺少足够的审核上下文。下一版应把审核理由、修改标签和引用状态更早暴露出来。",
        actionLabel: targetDraft ? "查看当前审核焦点" : "等待草稿",
        tone: "warn",
        target: targetDraft
          ? {
              type: "review",
              taskId: targetDraft.taskId,
              sourceSurface: "product-adaptation",
              sourceLabel: "把审核决策前置到案件概览",
              statusFilter: targetDraft.reviewStatus,
              listMode: targetDraft.reviewStatus === "pending" ? "pending" : "all",
            }
          : { type: "none" },
      });
    }

    if (
      matterInteractionSummary.caseWriteCount >= 2 ||
      matterInteractionSummary.dominantSurface?.label === "blocked-by" ||
      matterInteractionSummary.dominantSurface?.label === "case-focus"
    ) {
      const blockerContext =
        blockingExplanations.find((item) => item.actionTab === "case")?.caseFocusContext ?? caseFocusContext ?? undefined;
      suggestions.push({
        key: "adapt-case-form",
        title: "为 CASE 补录增加结构化表单",
        detail:
          "律师反复回到 CASE 补档，说明自由文本入口不够顺手。下一版应把事实缺口、风险确认、策略目标拆成更显式的结构化输入，而不是只靠文本写回。",
        actionLabel: "查看当前 CASE 焦点",
        tone: "info",
        target: { type: "case", context: blockerContext },
      });
    }

    if (matterInteractionSummary.memorySaveCount >= 2) {
      suggestions.push({
        key: "adapt-memory-fastlane",
        title: "把认知升级做成快捷采纳通道",
        detail:
          "当前案件已经多次把建议写入长期记忆，说明认知沉淀不是偶发动作。下一版适合把高频升级建议做成更靠前的快捷采纳区，而不是藏在认知深层。",
        actionLabel: "查看认知页",
        tone: "success",
        target: { type: "cognition" },
      });
    }

    if (
      suggestions.length === 0 &&
      matterInteractionSummary.total > 0 &&
      matterInteractionSummary.dominantSurface &&
      matterInteractionSummary.dominantSurface.count >= 3
    ) {
      suggestions.push({
        key: "adapt-default-focus",
        title: "默认视图可能需要重新排序",
        detail: `当前最常进入的入口是 ${matterInteractionSurfaceLabel(
          matterInteractionSummary.dominantSurface.label,
        )}。如果这个模式持续出现在更多案件，下一版可以考虑让相关区域更早出现或默认展开。`,
        actionLabel: "继续观察",
        tone: "neutral",
        target: { type: "none" },
      });
    }

    return suggestions.slice(0, 3);
  }, [
    approvedDrafts,
    blockingExplanations,
    caseFocusContext,
    drafts,
    matterInteractionSummary,
    modifiedDrafts,
    pendingDrafts,
  ]);

  const productExperimentChecklist = useMemo<MatterProductExperimentItem[]>(() => {
    const items: MatterProductExperimentItem[] = [];

    for (const suggestion of productAdaptationSuggestions) {
      if (suggestion.key === "adapt-review-surface") {
        items.push({
          key: "exp-review-context",
          title: "实验：把审核上下文前置到概览",
          hypothesis: "如果在概览页提前暴露审核理由、引用状态和修改标签，律师进入审核台的往返次数会下降。",
          validation: "观察后续同类案件里“进入审核”次数是否下降，以及是否减少从概览跳审核后的立即返回。",
          signal: `当前案件已出现 ${matterInteractionSummary.reviewOpenCount} 次进入审核动作。`,
          priority: "high",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
        continue;
      }
      if (suggestion.key === "adapt-case-form") {
        items.push({
          key: "exp-case-structured-form",
          title: "实验：把 CASE 补录改成结构化录入",
          hypothesis: "如果把事实缺口、风险确认、策略目标拆成结构化字段，律师反复回 CASE 补文本的次数会下降。",
          validation: "观察后续案件里“补 CASE”次数是否下降，并检查是否更少出现同主题重复写回。",
          signal: `当前案件已出现 ${matterInteractionSummary.caseWriteCount} 次 CASE 写回动作。`,
          priority: "high",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
        continue;
      }
      if (suggestion.key === "adapt-memory-fastlane") {
        items.push({
          key: "exp-memory-fastlane",
          title: "实验：把认知升级做成快捷采纳区",
          hypothesis: "如果高频升级建议更早出现在驾驶舱里，律师会更愿意及时沉淀长期记忆，而不是等到认知深层再操作。",
          validation: "观察后续案件里认知建议采纳是否更早发生，且是否减少同一建议在单案内的重复检视。",
          signal: `当前案件已出现 ${matterInteractionSummary.memorySaveCount} 次长期记忆写入动作。`,
          priority: "medium",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
        continue;
      }
      if (suggestion.key === "adapt-default-focus") {
        items.push({
          key: "exp-default-focus",
          title: "实验：调整默认展开与默认聚焦顺序",
          hypothesis: "如果默认把高频入口更早展示，律师会减少为了找到同一入口而反复切换页面。",
          validation: "观察更多案件里 dominant surface 是否稳定重复，再决定是否调整默认视图顺序。",
          signal: suggestion.detail,
          priority: "low",
          actionLabel: suggestion.actionLabel,
          target: suggestion.target,
        });
      }
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return items.toSorted((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]).slice(0, 4);
  }, [matterInteractionSummary.caseWriteCount, matterInteractionSummary.memorySaveCount, matterInteractionSummary.reviewOpenCount, productAdaptationSuggestions]);

  const crossMatterExperimentBoard = useMemo(() => {
    return crossExperimentRollup.map((item) => {
      const localSuggestion =
        productAdaptationSuggestions.find((suggestion) => suggestion.key === item.key) ??
        convergenceSuggestions.find((suggestion) => suggestion.key === item.key);
      return {
        ...item,
        includesCurrentMatter: Boolean(matterId && item.exampleMatterIds.includes(matterId)),
        localSuggestion,
      };
    });
  }, [convergenceSuggestions, crossExperimentRollup, productAdaptationSuggestions, matterId]);

  const roadmapCandidates = useMemo<MatterRoadmapCandidate[]>(() => {
    return crossMatterExperimentBoard
      .map((item) => {
        const baseScore = item.matterCount * 10 + item.totalEvents * 2 + (item.includesCurrentMatter ? 3 : 0);
        const bias =
          item.key === "adapt-review-surface"
            ? 5
            : item.key === "adapt-case-form"
              ? 4
              : item.key === "adapt-memory-fastlane"
                ? 3
                : 1;
        const score = baseScore + bias;
        const urgency: MatterRoadmapCandidate["urgency"] = score >= 28 ? "now" : score >= 16 ? "next" : "later";
        const readiness: MatterRoadmapCandidate["readiness"] =
          item.matterCount >= 3 || item.totalEvents >= 8 ? "validated" : score >= 16 ? "emerging" : "watching";
        const rationale =
          item.key === "adapt-review-surface"
            ? "多个案件都在重复把审核上下文留到审核台，说明概览层的信息前置价值最高。"
            : item.key === "adapt-case-form"
              ? "多个案件都在反复补 CASE 文本，说明结构化补录已经接近共性需求。"
              : item.key === "adapt-memory-fastlane"
                ? "多个案件都在持续沉淀长期记忆，说明认知升级正在从偶发动作走向常规流程。"
                : "同一入口在多个案件中持续高频出现，说明默认展示顺序可能已经需要调整。";
        const owner =
          item.key === "adapt-review-surface"
            ? "案件概览 / 审核流"
            : item.key === "adapt-case-form"
              ? "CASE 档案层"
              : item.key === "adapt-memory-fastlane"
                ? "认知面板"
                : "工作台框架";
        const benefit =
          item.key === "adapt-review-surface"
            ? "减少律师在概览与审核台之间的来回切换，把关键待审信号前置到主工作面。"
            : item.key === "adapt-case-form"
              ? "把反复补录的案件说明转成结构化输入，降低自由文本维护成本。"
              : item.key === "adapt-memory-fastlane"
                ? "把高频经验沉淀动作缩短成一跳，提升规则复用效率。"
                : "让高频动作更贴近默认入口，降低律师寻找下一步的认知负担。";
        const risk =
          item.key === "adapt-review-surface"
            ? "如果前置内容过多，概览可能重新变重，影响快速扫读。"
            : item.key === "adapt-case-form"
              ? "表单字段一旦设计过早，容易限制律师的表达弹性。"
              : item.key === "adapt-memory-fastlane"
                ? "过快沉淀可能把尚未稳定的经验写入长期记忆。"
                : "入口顺序调整如果没有伴随真实收益，容易制造新的导航习惯成本。";
        return {
          key: item.key,
          title: item.title,
          score,
          rationale,
          urgency,
          readiness,
          owner,
          benefit,
          risk,
          matterCount: item.matterCount,
          totalEvents: item.totalEvents,
          latestAt: item.latestAt,
          localSuggestion: item.localSuggestion,
        };
      })
      .toSorted((a, b) => (b.score - a.score) || a.title.localeCompare(b.title, "zh-CN"))
      .slice(0, 5);
  }, [crossMatterExperimentBoard]);

  const roadmapPressureSummary = useMemo(() => {
    const nowCount = roadmapCandidates.filter((item) => item.urgency === "now").length;
    const validatedCount = roadmapCandidates.filter((item) => item.readiness === "validated").length;
    const topCandidate = roadmapCandidates[0] ?? null;
    return {
      candidateCount: roadmapCandidates.length,
      nowCount,
      validatedCount,
      topCandidate,
    };
  }, [roadmapCandidates]);

  const openReviewFromMatter = useCallback(
    (taskId: string, overrides?: {
      matterId?: string;
      statusFilter?: ArtifactDraft["reviewStatus"] | "all";
      listMode?: "pending" | "all";
      sourceSurface?: string;
      sourceLabel?: string;
    }) => {
      if (!onOpenReview) {
        return;
      }
      void logMatterInteraction({
        action: "open_review",
        taskId,
        surface: overrides?.sourceSurface ?? "overview",
        label: overrides?.sourceLabel ?? "进入审核台",
      });
      onOpenReview({
        taskId,
        matterId: overrides?.matterId ?? matterId ?? undefined,
        statusFilter: overrides?.statusFilter ?? reviewTargetForFocus.statusFilter,
        listMode: overrides?.listMode ?? reviewTargetForFocus.listMode,
      });
    },
    [logMatterInteraction, onOpenReview, reviewTargetForFocus, matterId],
  );

  const handleBlockingAction = useCallback(
    (item: { actionTaskId?: string; actionTab?: "case" | "tasks"; caseFocusContext?: CaseFocusContext }) => {
      if (item.actionTaskId) {
        openReviewFromMatter(item.actionTaskId, {
          sourceSurface: "blocked-by",
          sourceLabel: item.caseFocusContext?.title ?? "Blocked By",
        });
        return;
      }
      if (item.actionTab) {
        setPanelTab(item.actionTab);
        if (item.actionTab === "case") {
          setCaseFocusContext(item.caseFocusContext ?? null);
          setSearchQ(item.caseFocusContext?.query ?? "");
          setSearchHits([]);
        }
      }
    },
    [openReviewFromMatter],
  );

  const handleConvergenceSuggestion = useCallback(
    (item: { target: MatterRecommendationTarget }) => {
      if (item.target.type === "review") {
        openReviewFromMatter(item.target.taskId, {
          statusFilter: item.target.statusFilter,
          listMode: item.target.listMode,
          sourceSurface: item.target.sourceSurface,
          sourceLabel: item.target.sourceLabel,
        });
        return;
      }
      if (item.target.type === "case") {
        setPanelTab("case");
        setCaseFocusContext(item.target.context ?? null);
        setSearchQ(item.target.context?.query ?? "");
        setSearchHits([]);
        return;
      }
      if (item.target.type === "cognition") {
        setPanelTab("cognition");
      }
    },
    [openReviewFromMatter],
  );

  async function saveUpgradeSuggestion(
    target: "lawyer" | "assistant",
    item: { label: string; recommendation: string; count: number },
  ) {
    const currentDraft = drafts.find((draft) => draft.taskId === cognitionTaskId) ?? null;
    const sourceMatter = matterId ? `来源案件 ${matterId}` : "来源案件未知";
    const sourceDraft = currentDraft
      ? `观察草稿《${currentDraft.title}》`
      : "观察草稿未知";
    const note = `${sourceMatter}；${sourceDraft}。认知升级建议：${item.label} 在当前案件关键草稿中命中 ${item.count} 次。${item.recommendation}`;
    const busyKey = `${target}:${item.label}`;
    setCognitionActionBusy(busyKey);
    setCognitionActionMsg(null);
    try {
      const path =
        target === "lawyer" ? "/api/lawyer-profile/learning" : "/api/assistants/profile/learning";
      const requestBody =
        target === "lawyer"
          ? { note, source: "manual" as const }
          : { assistantId: assistantId ?? "default", note };
      const j = await apiSendJson<
        { ok?: boolean; error?: string; message?: string },
        { note: string; source?: string; assistantId?: string }
      >(apiBase, path, "POST", requestBody);
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "写入失败"));
      }
      setCognitionActionMsg(
        target === "lawyer" ? "已写入律师档案。后续案件将可复用该升级建议。" : "已写入当前助手档案。",
      );
      await logMatterInteraction({
        action: "save_upgrade_suggestion",
        taskId: currentDraft?.taskId ?? undefined,
        surface: "cognition",
        label: item.label,
        target,
      });
      setAdoptedSuggestions((prev) =>
        [
          {
            key: `${target}:${item.label}:${Date.now()}`,
            target,
            label: item.label,
            matterId: matterId,
            taskId: currentDraft?.taskId ?? null,
            draftTitle: currentDraft?.title ?? null,
            savedAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 8),
      );
      void loadPersistentAdoptions();
    } catch (e) {
      setCognitionActionMsg(errorMessage(e, "写入失败"));
    } finally {
      setCognitionActionBusy(null);
    }
  }

  async function writeCaseFocusNote() {
    if (!matterId || !caseFocusContext) {
      return;
    }
    setCaseActionBusy(true);
    setCaseActionMsg(null);
    try {
      const note = caseDraftNote.trim() || `${caseFocusContext.title}：${caseFocusContext.hint}`;
      const j = await apiSendJson<
        { ok?: boolean; error?: string; message?: string },
        { matterId: string; section: string; note: string }
      >(apiBase, "/api/matters/case-note", "POST", {
        matterId: matterId,
        section: sectionWriteTarget(caseFocusContext.section),
        note,
      });
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "写入案件档案失败"));
      }
      await logMatterInteraction({
        action: "write_case_note",
        surface: "case-focus",
        label: caseFocusContext.title,
        variant: caseDraftVariant,
        section: sectionWriteTarget(caseFocusContext.section),
      });
      setCaseActionMsg("已写入案件档案。");
      await loadDetail(matterId);
    } catch (e) {
      setCaseActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCaseActionBusy(false);
    }
  }

  const reviewSummaryCards: Array<{
    key: string;
    title: string;
    count: number;
    tone: "warn" | "info" | "success" | "neutral";
    hint: string;
    actionLabel: string;
    actionTaskId?: string;
    statusFilter: ArtifactDraft["reviewStatus"] | "all";
    listMode: "pending" | "all";
  }> = [
    {
      key: "pending-review",
      title: "待审核草稿",
      count: pendingDrafts.length,
      tone: "warn",
      hint: pendingDrafts[0]?.title ?? "当前没有待审核草稿",
      actionLabel: pendingDrafts.length > 0 ? "去处理" : "已清空",
      actionTaskId: pendingDrafts[0]?.taskId,
      statusFilter: "pending",
      listMode: "pending",
    },
    {
      key: "needs-changes",
      title: "需修改返回",
      count: modifiedDrafts.length,
      tone: "info",
      hint: modifiedDrafts[0]?.title ?? "当前没有需修改草稿",
      actionLabel: modifiedDrafts.length > 0 ? "去复核" : "无待办",
      actionTaskId: modifiedDrafts[0]?.taskId,
      statusFilter: "modified",
      listMode: "all",
    },
    {
      key: "ready-to-render",
      title: "可渲染交付",
      count: approvedDrafts.length,
      tone: "success",
      hint: approvedDrafts[0]?.title ?? "当前没有可直接交付草稿",
      actionLabel: approvedDrafts.length > 0 ? "去交付" : "暂无",
      actionTaskId: approvedDrafts[0]?.taskId,
      statusFilter: "approved",
      listMode: "all",
    },
    {
      key: "pending-approval",
      title: "高风险审批",
      count: elevatedApprovals.length,
      tone: "neutral",
      hint: elevatedApprovals[0]?.reason ?? "当前没有高风险审批项",
      actionLabel: elevatedApprovals.length > 0 ? "去查看" : "正常",
      actionTaskId: elevatedApprovals[0]?.deliverableId,
      statusFilter: "all",
      listMode: "all",
    },
  ];

  async function loadPersistentAdoptions() {
    try {
      const params = new URLSearchParams();
      if (assistantId) {
        params.set("assistantId", assistantId);
      }
      const q = params.toString();
      const j = await apiGetJson<{ ok?: boolean; items?: PersistentAdoptionItem[] }>(
        apiBase,
        `/api/memory/adoptions${q ? `?${q}` : ""}`,
      );
      if (!j.ok || !Array.isArray(j.items)) {
        return;
      }
      const items = j.items
        .map((item, index) => {
          const matterMatch = /来源案件\s+([^\s；。]+)/.exec(item.body);
          const taskMatch = /任务\s+([^)）]+)/.exec(item.body);
          const draftMatch = /观察草稿\s+(.+?)（任务/.exec(item.body);
          const labelMatch = /认知升级建议：(.+?)\s+在当前案件关键草稿中命中/.exec(item.body);
          return {
            key: `persist:${item.target}:${item.stamp}:${index}`,
            target: item.target,
            label: labelMatch?.[1]?.trim() ?? item.body.slice(0, 40),
            matterId: matterMatch?.[1]?.trim() ?? null,
            taskId: taskMatch?.[1]?.trim() ?? null,
            draftTitle: draftMatch?.[1]?.trim() ?? null,
            savedAt: item.stamp,
            rawBody: item.body,
          } satisfies AdoptedSuggestionRecord;
        })
      setPersistentAdoptions(items);
    } catch {
      setPersistentAdoptions([]);
    }
  }

  async function loadCrossExperimentRollup() {
    try {
      const j = await apiGetJson<{
        ok?: boolean;
        items?: MatterCrossExperimentRollupItem[];
      }>(apiBase, "/api/matters/interaction-rollup");
      if (!j.ok || !Array.isArray(j.items)) {
        return;
      }
      setCrossExperimentRollup(j.items);
    } catch {
      setCrossExperimentRollup([]);
    }
  }

  useEffect(() => {
    setCaseFocusContext(null);
  }, [matterId]);

  useEffect(() => {
    setCaseDraftVariant("standard");
    setCaseDraftNote(caseFocusContext ? buildCaseFocusDraft(caseFocusContext, "standard") : "");
    setCaseActionMsg(null);
  }, [caseFocusContext]);

  useEffect(() => {
    void loadPersistentAdoptions();
  }, [apiBase, assistantId, matterId]);

  useEffect(() => {
    if (!showCrossMatterRoadmap) {
      setCrossExperimentRollup([]);
      return;
    }
    void loadCrossExperimentRollup();
  }, [apiBase, refreshVersion, showCrossMatterRoadmap]);

  useEffect(() => {
    if (panelTab !== "case" || !caseFocusContext?.section) {
      return;
    }
    const target =
      caseFocusContext.section === "core-issues"
        ? coreIssuesRef.current
        : caseFocusContext.section === "risk-notes"
          ? riskNotesRef.current
          : caseFocusContext.section === "artifacts"
            ? artifactsRef.current
            : caseMdRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [caseFocusContext, panelTab]);

  const adoptionHistoryInsight = useMemo<AdoptionHistoryInsight>(() => {
    const scoped = matterId
      ? persistentAdoptions.filter((item) => item.matterId === matterId)
      : persistentAdoptions;
    const relevantLabels = new Set(scoped.map((item) => item.label));
    const counts = new Map<string, { count: number; matterIds: Set<string>; latestSavedAt?: string }>();
    for (const item of persistentAdoptions) {
      if (matterId && !relevantLabels.has(item.label)) {
        continue;
      }
      const current = counts.get(item.label) ?? { count: 0, matterIds: new Set<string>(), latestSavedAt: undefined };
      current.count += 1;
      if (item.matterId) {
        current.matterIds.add(item.matterId);
      }
      if (!current.latestSavedAt || item.savedAt > current.latestSavedAt) {
        current.latestSavedAt = item.savedAt;
      }
      counts.set(item.label, current);
    }
    return {
      total: scoped.length,
      lawyerCount: scoped.filter((item) => item.target === "lawyer").length,
      assistantCount: scoped.filter((item) => item.target === "assistant").length,
      crossMatterCount: new Set(scoped.map((item) => item.matterId).filter(Boolean)).size,
      latestSavedAt: scoped.map((item) => item.savedAt).toSorted().at(-1),
      repeatedLabels: Array.from(counts.entries())
        .map(([label, meta]) => ({
          label,
          count: meta.count,
          matterIds: Array.from(meta.matterIds).toSorted(),
          latestSavedAt: meta.latestSavedAt,
        }))
        .filter((item) => item.count >= 2)
        .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
        .slice(0, 5),
    };
  }, [persistentAdoptions, matterId]);

  const visiblePersistentAdoptions = useMemo(
    () =>
      persistentAdoptions
        .filter((item) => !matterId || item.matterId === matterId)
        .toSorted((a, b) => b.savedAt.localeCompare(a.savedAt))
        .slice(0, 8),
    [persistentAdoptions, matterId],
  );

  useEffect(() => {
    if (!hasHandledRefreshRef.current) {
      hasHandledRefreshRef.current = true;
      return;
    }
    if (!isAppSidebar) {
      void loadList();
    }
    if (matterId) {
      void loadDetail(matterId);
    }
  }, [refreshVersion, loadDetail, loadList, matterId, isAppSidebar]);

  useEffect(() => {
    if (matterId !== prevSelectedMatterForCognitionRef.current) {
      prevSelectedMatterForCognitionRef.current = matterId ?? null;
      setCognitionTaskId(cognitionDefaultTaskId);
      return;
    }
    setCognitionTaskId((prev) => {
      if (!prev) {
        return cognitionDefaultTaskId;
      }
      if (!drafts.some((d) => d.taskId === prev)) {
        return cognitionDefaultTaskId;
      }
      return prev;
    });
  }, [matterId, cognitionDefaultTaskId, drafts]);

  useEffect(() => {
    if (prevNavKeyRef.current === navKey) {
      return;
    }
    prevNavKeyRef.current = navKey;
    if (isUnlinkedBucket) {
      setPanelTab("ledger");
    } else if (navKey) {
      setPanelTab("overview");
    }
  }, [navKey, isUnlinkedBucket]);

  const fetchDraftCognition = useCallback(
    async (taskId: string) => {
      const j = await apiGetJson<{
        ok?: boolean;
        reasoningMarkdown?: string | null;
        memorySources?: MemorySourceLayer[];
        error?: string;
      }>(apiBase, `/api/drafts/${encodeURIComponent(taskId)}`);
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "加载认知面板失败"));
      }
      return {
        reasoningMarkdown: typeof j.reasoningMarkdown === "string" ? j.reasoningMarkdown : null,
        memorySources: Array.isArray(j.memorySources) ? j.memorySources : [],
      };
    },
    [apiBase],
  );

  const loadCognitionDetail = useCallback(
    async (taskId: string) => {
      setCognitionLoading(true);
      setCognitionError(null);
      try {
        const detail = await fetchDraftCognition(taskId);
        setCognitionReasoningMarkdown(detail.reasoningMarkdown);
        setCognitionMemorySources(detail.memorySources);
      } catch (e) {
        setCognitionReasoningMarkdown(null);
        setCognitionMemorySources([]);
        setCognitionError(errorMessage(e, "加载认知面板失败"));
      } finally {
        setCognitionLoading(false);
      }
    },
    [fetchDraftCognition],
  );

  useEffect(() => {
    if (!cognitionTaskId) {
      setCognitionReasoningMarkdown(null);
      setCognitionMemorySources([]);
      setCognitionError(null);
      return;
    }
    void loadCognitionDetail(cognitionTaskId);
  }, [cognitionTaskId, loadCognitionDetail]);

  useEffect(() => {
    let cancelled = false;

    async function loadCognitionBoard() {
      if (cognitionBoardDrafts.length === 0) {
        setCognitionBoard(null);
        setCognitionBoardError(null);
        return;
      }
      setCognitionBoardLoading(true);
      setCognitionBoardError(null);
      try {
        const entries = await Promise.all(
          cognitionBoardDrafts.map(async (draft) => ({
            draft,
            ...(await fetchDraftCognition(draft.taskId)),
          })),
        );
        if (cancelled) {
          return;
        }
        const layerCounts = new Map<string, { count: number; injected: boolean }>();
        for (const entry of entries) {
          const seenLabels = new Set<string>();
          for (const layer of entry.memorySources) {
            if (seenLabels.has(layer.label)) {
              continue;
            }
            seenLabels.add(layer.label);
            const current = layerCounts.get(layer.label) ?? { count: 0, injected: false };
            current.count += 1;
            current.injected = current.injected || Boolean(layer.inAgentSystemPrompt);
            layerCounts.set(layer.label, current);
          }
        }
        const board: MatterCognitionBoard = {
          observedDraftCount: entries.length,
          reasoningDraftCount: entries.filter((entry) => Boolean(entry.reasoningMarkdown?.trim())).length,
          missingReasoningCount: entries.filter((entry) => !entry.reasoningMarkdown?.trim()).length,
          missingCitationCount: entries.filter((entry) => {
            const cit = draftCitationByTask[entry.draft.taskId];
            return !cit || !cit.checked || !cit.ok;
          }).length,
          uniqueMemoryLayerCount: layerCounts.size,
          injectedMemoryLayerCount: Array.from(layerCounts.values()).filter((entry) => entry.injected).length,
          candidateMemoryLayerCount: Array.from(layerCounts.values()).filter((entry) => !entry.injected).length,
          missingMemoryLayerCount: Array.from(entries.flatMap((entry) => entry.memorySources)).filter(
            (layer) => !layer.exists,
          ).length,
          uncoveredFrequentLayerCount: Array.from(layerCounts.values()).filter(
            (entry) => !entry.injected && entry.count >= 2,
          ).length,
          newestDraftAt: entries.map((entry) => entry.draft.createdAt).toSorted().at(-1),
          oldestDraftAt: entries.map((entry) => entry.draft.createdAt).toSorted().at(0),
          topMemoryLayers: Array.from(layerCounts.entries())
            .map(([label, meta]) => ({ label, ...meta }))
            .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
            .slice(0, 6),
          memoryCategories: [
            {
              key: "injected",
              title: "已注入核心记忆",
              count: Array.from(layerCounts.values()).filter((entry) => entry.injected).length,
              hint: "这些层已经进入 system prompt，直接参与当前推理。",
            },
            {
              key: "candidate",
              title: "检索候选真相源",
              count: Array.from(layerCounts.values()).filter((entry) => !entry.injected).length,
              hint: "这些层更多通过检索或辅助读取进入工作流，还没成为核心常驻记忆。",
            },
            {
              key: "missing",
              title: "缺失但应存在",
              count: Array.from(entries.flatMap((entry) => entry.memorySources)).filter((layer) => !layer.exists)
                .length,
              hint: "这些层被工作流期待，但对应文件当前缺失，可能导致推理不稳。",
            },
          ],
          missingMemoryLayers: (() => {
            const missingCounts = new Map<string, number>();
            for (const entry of entries) {
              for (const layer of entry.memorySources) {
                if (layer.exists) {
                  continue;
                }
                missingCounts.set(layer.label, (missingCounts.get(layer.label) ?? 0) + 1);
              }
            }
            return Array.from(missingCounts.entries())
              .map(([label, count]) => ({ label, count }))
              .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
              .slice(0, 6);
          })(),
          upgradeSuggestions: Array.from(layerCounts.entries())
            .map(([label, meta]) => ({ label, count: meta.count, injected: meta.injected }))
            .filter((entry) => !entry.injected && entry.count >= 2)
            .toSorted((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "zh-CN"))
            .slice(0, 5)
            .map((entry) => ({
              label: entry.label,
              count: entry.count,
              recommendation: memoryUpgradeRecommendation(entry.label),
            })),
          draftCoverage: entries.map((entry) => ({
            taskId: entry.draft.taskId,
            title: entry.draft.title,
            status: entry.draft.reviewStatus,
            hasReasoning: Boolean(entry.reasoningMarkdown?.trim()),
            memoryLayerCount: entry.memorySources.length,
            citationState: (() => {
              const cit = draftCitationByTask[entry.draft.taskId];
              if (!cit || !cit.checked) {
                return "missing" as const;
              }
              return cit.ok ? ("ok" as const) : ("warn" as const);
            })(),
            createdAt: entry.draft.createdAt,
          })),
        };
        setCognitionBoard(board);
      } catch (e) {
        if (!cancelled) {
          setCognitionBoard(null);
          setCognitionBoardError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setCognitionBoardLoading(false);
        }
      }
    }

    void loadCognitionBoard();
    return () => {
      cancelled = true;
    };
  }, [cognitionBoardCitationFingerprint, cognitionBoardDrafts, fetchDraftCognition]);

  const cognitionDraft = drafts.find((draft) => draft.taskId === cognitionTaskId) ?? null;

  useEffect(() => {
    const tid = cognitionTaskId?.trim();
    if (!tid || !apiBase) {
      setCognitionReasoningReport(null);
      return;
    }
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; reasoningReport?: import("../../../../src/lawmind/deliverables/index.ts").ReasoningReport | null }>(
      apiBase,
      `/api/drafts/${encodeURIComponent(tid)}`,
    )
      .then((j) => {
        if (!cancelled && j.ok) {
          setCognitionReasoningReport(j.reasoningReport ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCognitionReasoningReport(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, cognitionTaskId]);

  const runSearch = useCallback(async () => {
    if (!matterId || !searchQ.trim()) {
      return;
    }
    setSearchBusy(true);
    setSearchIndexMissing(false);
    try {
      const q = encodeURIComponent(searchQ.trim());
      const mid = encodeURIComponent(matterId);
      const [matterRes, workspaceRes] = await Promise.all([
        apiGetJson<{ ok?: boolean; hits?: MatterSearchHit[] }>(
          apiBase,
          `/api/matters/search?matterId=${mid}&q=${q}`,
        ),
        searchQ.trim().length >= 2
          ? apiGetJson<{
              ok?: boolean;
              hits?: Array<{
                source: "audit" | "session";
                snippet: string;
                taskId?: string;
                timestamp?: string;
              }>;
              indexMissing?: boolean;
            }>(apiBase, `/api/search/workspace?matterId=${mid}&q=${q}&limit=20`)
          : Promise.resolve(null),
      ]);
      const merged: MatterSearchHit[] = [];
      if (matterRes.ok && Array.isArray(matterRes.hits)) {
        for (const h of matterRes.hits) {
          merged.push({ ...h, source: "matter" });
        }
      }
      if (workspaceRes?.ok && Array.isArray(workspaceRes.hits)) {
        for (const h of workspaceRes.hits) {
          const section =
            h.source === "audit" ? "审计" : h.source === "session" ? "会话" : "工作区";
          merged.push({
            section,
            text: h.snippet,
            taskId: h.taskId,
            source: h.source,
          });
        }
      }
      setSearchHits(merged);
      if (workspaceRes?.indexMissing) {
        setSearchIndexMissing(true);
      }
    } finally {
      setSearchBusy(false);
    }
  }, [apiBase, matterId, searchQ]);

  return (
    <>
      <LawmindCreateMatterDialog
        open={showCreate}
        apiBase={apiBase}
        onClose={() => setShowCreate(false)}
        onSuccess={(mid) => {
          if (!isAppSidebar) {
            void loadList();
          }
          if (isAppSidebar) {
            onMatterCreated?.(mid);
          } else {
            setInternalSelectedId(mid);
          }
          setPanelTab("overview");
        }}
      />
      <div className="lm-workbench lm-matter-workbench">
      {!isAppSidebar ? (
        <>
          <div
            className="lm-workbench-list"
            style={{ width: workbenchListWidth, flexShrink: 0 }}
          >
        <div className="lm-workbench-list-header">
          <h2>案件</h2>
          <div className="lm-workbench-list-actions">
            <button
              type="button"
              className="lm-btn lm-btn-small"
              onClick={() => {
                setShowCreate(true);
              }}
            >
              新建案件
            </button>
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => void loadList()}>
              刷新
            </button>
          </div>
        </div>
        {loadingList && <div className="lm-meta">加载中…</div>}
        {listError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{listError}</p>
          </div>
        ) : null}
        {!loadingList && overviews.length === 0 && (
          <div className="lm-meta lm-workbench-empty">暂无案件</div>
        )}
        <ul className="lm-workbench-matter-list">
          {overviews.map((o) => (
            <li key={o.matterId}>
              <button
                type="button"
                className={`lm-matter-row ${internalSelectedId === o.matterId ? "active" : ""}`}
                title={`案件编号：${o.matterId}。右键可关联对话或打开文件夹。`}
                onClick={() => {
                  setInternalSelectedId(o.matterId);
                  setPanelTab("overview");
                }}
                onContextMenu={(e) => {
                  const canChat = Boolean(onUseInChat);
                  const canFolder = Boolean(
                    workspaceDir?.trim() && typeof window !== "undefined" && window.lawmindDesktop?.showItemInFolder,
                  );
                  if (!canChat && !canFolder) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  setMatterListCtx({ x: e.clientX, y: e.clientY, matterId: o.matterId });
                }}
              >
                <span className="lm-matter-id">
                  {ellipsisText(o.displayName?.trim() || o.matterId, 46)}
                </span>
                {o.displayName?.trim() && o.displayName.trim() !== o.matterId ? (
                  <span className="lm-matter-meta">{ellipsisText(o.matterId, 36)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="lm-split-handle lm-split-handle-vertical"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整案件列表宽度"
        title="拖动调整列表宽度"
        onPointerDown={onMatterListResize}
      />
        </>
      ) : null}

      <div className="lm-workbench-main">
        {!navKey && (
          <div className="lm-meta lm-workbench-placeholder">
            {isAppSidebar
              ? "在左侧 cases/ 目录或下方案件列表中选择案件"
              : "选择案件"}
          </div>
        )}

        {isUnlinkedBucket && showShellOps ? (
          <>
            <div className="lm-workbench-toolbar">
              <div className="lm-workbench-title-block">
                <h2>未关联案件</h2>
                <p className="lm-meta">下列任务与交付尚未关联案件编号，建议在工作台中归入具体案件。</p>
              </div>
            </div>
            <div className="lm-tabs lm-workbench-tabs">
              <button
                type="button"
                className={`lm-tab ${panelTab === "ledger" ? "active" : ""}`}
                onClick={() => setPanelTab("ledger")}
              >
                任务台帐
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "deliveries" ? "active" : ""}`}
                onClick={() => setPanelTab("deliveries")}
              >
                交付记录
              </button>
            </div>
            {panelTab === "ledger" && (
              <MatterShellRecordsPanel
                mode="ledger"
                shellTasksScoped={shellTasksScoped}
                shellHistoryScoped={shellHistoryScoped}
                shellAssistantDisplayById={shellAssistantDisplayById}
                shellLegalStatusLabel={shellLegalStatusLabel}
                shellTaskBadgeClass={shellTaskBadgeClass}
                shellHistoryBadgeClass={shellHistoryBadgeClass}
                formatShellRelativeTime={formatShellRelativeTime}
                onOpenShellDetail={onOpenShellDetail}
              />
            )}
            {panelTab === "deliveries" && (
              <MatterShellRecordsPanel
                mode="deliveries"
                shellTasksScoped={shellTasksScoped}
                shellHistoryScoped={shellHistoryScoped}
                shellAssistantDisplayById={shellAssistantDisplayById}
                shellLegalStatusLabel={shellLegalStatusLabel}
                shellTaskBadgeClass={shellTaskBadgeClass}
                shellHistoryBadgeClass={shellHistoryBadgeClass}
                formatShellRelativeTime={formatShellRelativeTime}
                onOpenShellDetail={onOpenShellDetail}
              />
            )}
          </>
        ) : null}

        {matterId && detailLoading && <div className="lm-meta">加载案件详情…</div>}
        {matterId && detailError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{detailError}</p>
          </div>
        ) : null}
        {matterId && !detailLoading && !detailError && summary && (
          <>
              <div className="lm-workbench-toolbar">
              <div className="lm-workbench-title-block">
                <h2 title={internalIdsTitle([{ label: "案件编号", value: matterId }])}>
                  {summary.headline?.trim() ? ellipsisText(summary.headline, 72) : "案件工作台"}
                </h2>
              </div>
            </div>

            <MatterWorkbenchTabs
              panelTab={panelTab}
              onSelect={setPanelTab}
              showShellOps={showShellOps}
            />

            {panelTab === "overview" && (
              <MatterOverviewBody
                apiBase={apiBase}
                matterId={matterId}
                summary={summary}
                selectedOverview={selectedOverview}
                showWorkspaceAcceptanceDashboard={showWorkspaceAcceptanceDashboard}
                workspaceAcceptance={workspaceAcceptance}
                workspaceAcceptanceErr={workspaceAcceptanceErr}
                matterOverviewExtrasOpen={matterOverviewExtrasOpen}
                setMatterOverviewExtrasOpen={setMatterOverviewExtrasOpen}
                reviewSummaryCards={reviewSummaryCards}
                onOpenReview={onOpenReview}
                openReviewFromMatter={openReviewFromMatter}
                opsFocus={opsFocus}
                setOpsFocus={setOpsFocus}
                opsSort={opsSort}
                setOpsSort={setOpsSort}
                blockingExplanations={blockingExplanations}
                handleBlockingAction={handleBlockingAction}
                queueItems={queueItems}
                approvalRequests={approvalRequests}
                matterInteractionSummary={matterInteractionSummary}
                showCrossMatterRoadmap={showCrossMatterRoadmap}
                convergenceSuggestions={convergenceSuggestions}
                handleConvergenceSuggestion={handleConvergenceSuggestion}
                productAdaptationSuggestions={productAdaptationSuggestions}
                productExperimentChecklist={productExperimentChecklist}
                crossMatterExperimentBoard={crossMatterExperimentBoard}
                roadmapCandidates={roadmapCandidates}
                adoptionHistoryInsight={adoptionHistoryInsight}
                visiblePersistentAdoptions={visiblePersistentAdoptions}
                adoptedSuggestions={adoptedSuggestions}
                roadmapPressureSummary={roadmapPressureSummary}
                recentMatterInteractions={recentMatterInteractions}
                filteredQueueItems={filteredQueueItems}
                filteredApprovalRequests={filteredApprovalRequests}
                filteredDrafts={filteredDrafts}
                draftCitationByTask={draftCitationByTask}
                acceptanceByTask={acceptanceByTask}
              />
            )}

            {panelTab === "case" && (
              <MatterCasePanel
                caseFocusContext={caseFocusContext}
                caseDraftVariant={caseDraftVariant}
                caseDraftNote={caseDraftNote}
                caseActionBusy={caseActionBusy}
                caseActionMsg={caseActionMsg}
                searchQ={searchQ}
                searchBusy={searchBusy}
                searchHits={searchHits}
                searchIndexMissing={searchIndexMissing}
                coreIssues={coreIssues}
                riskNotes={riskNotes}
                artifacts={artifacts}
                caseMemory={caseMemory}
                caseTruncated={caseTruncated}
                coreIssuesRef={coreIssuesRef}
                riskNotesRef={riskNotesRef}
                artifactsRef={artifactsRef}
                caseMdRef={caseMdRef}
                onClearCaseFocus={() => setCaseFocusContext(null)}
                onCaseDraftVariantChange={setCaseDraftVariant}
                onCaseDraftNoteChange={setCaseDraftNote}
                onSearchQueryChange={setSearchQ}
                onRunSearch={() => void runSearch()}
                onWriteCaseFocusNote={() => void writeCaseFocusNote()}
              />
            )}

            {panelTab === "tasks" && (
              <MatterTasksPanel
                apiBase={apiBase}
                matterId={matterId}
                tasks={tasks}
                drafts={drafts}
                queueItems={queueItems}
                approvalRequests={approvalRequests}
                acceptanceByTask={acceptanceByTask}
                draftCitationByTask={draftCitationByTask}
                onOpenReview={onOpenReview}
                onOpenWorkflowLibrary={onOpenWorkflowLibrary}
                onOpenChatSession={onOpenChatSession}
                jobs={matterJobs}
              />
            )}

            {panelTab === "matrix" && matterId ? (
              <MatterReviewMatrixPanel
                apiBase={apiBase}
                matterId={matterId}
                onOpenReview={onOpenReview}
              />
            ) : null}

            {panelTab === "timeline" && (
              <div className="lm-workbench-panel">
                <h3>工作进展</h3>
                <ul className="lm-bullet-list">
                  {progressEntries.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                {sessionTimeline.length > 0 ? (
                  <>
                    <h3>最近动态</h3>
                    <ul className="lm-bullet-list">
                      {sessionTimeline.map((e) => (
                        <li key={e.id} className={e.severity === "warn" ? "lm-timeline-warn" : undefined}>
                          <span className="lm-meta">{e.timestamp}</span> {e.label}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <h3>审计事件</h3>
                <ul className="lm-audit-list">
                  {auditEvents.map((e, i) => (
                    <li key={i}>
                      <span className="lm-audit-kind">{auditKindLabel(e.kind)}</span>
                      <span className="lm-audit-time">{e.timestamp}</span>
                      <div className="lm-audit-detail">{e.detail}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {panelTab === "cognition" && (
              <MatterCognitionPanel
                apiBase={apiBase}
                matterId={matterId}
                reasoningReport={cognitionReasoningReport}
                drafts={drafts}
                cognitionTaskId={cognitionTaskId}
                setCognitionTaskId={setCognitionTaskId}
                cognitionDraft={cognitionDraft}
                cognitionBoardLoading={cognitionBoardLoading}
                cognitionBoardError={cognitionBoardError}
                cognitionBoard={cognitionBoard}
                cognitionLoading={cognitionLoading}
                cognitionError={cognitionError}
                cognitionReasoningMarkdown={cognitionReasoningMarkdown}
                cognitionMemorySources={cognitionMemorySources}
                cognitionActionBusy={cognitionActionBusy}
                cognitionActionMsg={cognitionActionMsg}
                draftCitationByTask={draftCitationByTask}
                adoptionHistoryInsight={adoptionHistoryInsight}
                visiblePersistentAdoptions={visiblePersistentAdoptions}
                adoptedSuggestions={adoptedSuggestions}
                saveUpgradeSuggestion={saveUpgradeSuggestion}
                onOpenReview={onOpenReview}
                openReviewFromMatter={openReviewFromMatter}
              />
            )}

            {panelTab === "meeting" && matterId ? (
              <div className="lm-workbench-panel">
                <section className="lm-matter-cockpit-card lm-matter-meeting-card">
                  <h3>与助手讨论本案</h3>
                  <MatterTeamMeetingPanel
                    apiBase={apiBase}
                    matterId={matterId}
                    shellAssistantId={assistantId?.trim() ? assistantId : "default"}
                    projectDir={projectDir}
                  />
                </section>
              </div>
            ) : null}

            {showShellOps && panelTab === "ledger" && (
              <MatterShellRecordsPanel
                mode="ledger"
                shellTasksScoped={shellTasksScoped}
                shellHistoryScoped={shellHistoryScoped}
                shellAssistantDisplayById={shellAssistantDisplayById}
                shellLegalStatusLabel={shellLegalStatusLabel}
                shellTaskBadgeClass={shellTaskBadgeClass}
                shellHistoryBadgeClass={shellHistoryBadgeClass}
                formatShellRelativeTime={formatShellRelativeTime}
                onOpenShellDetail={onOpenShellDetail}
              />
            )}

            {showShellOps && panelTab === "deliveries" && (
              <MatterShellRecordsPanel
                mode="deliveries"
                shellTasksScoped={shellTasksScoped}
                shellHistoryScoped={shellHistoryScoped}
                shellAssistantDisplayById={shellAssistantDisplayById}
                shellLegalStatusLabel={shellLegalStatusLabel}
                shellTaskBadgeClass={shellTaskBadgeClass}
                shellHistoryBadgeClass={shellHistoryBadgeClass}
                formatShellRelativeTime={formatShellRelativeTime}
                onOpenShellDetail={onOpenShellDetail}
              />
            )}

          </>
        )}
      </div>
    </div>
    {matterListCtx && !isAppSidebar ? (
      <LawmindMatterContextMenu
        x={matterListCtx.x}
        y={matterListCtx.y}
        onClose={() => setMatterListCtx(null)}
      >
        {onUseInChat ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onUseInChat(matterListCtx.matterId);
              setMatterListCtx(null);
            }}
          >
            在对话中关联本案
          </button>
        ) : null}
        {workspaceDir?.trim() && typeof window !== "undefined" && window.lawmindDesktop?.showItemInFolder ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const p = `${workspaceDir.replace(/[/\\]+$/, "")}/cases/${matterListCtx.matterId}`;
              void window.lawmindDesktop?.showItemInFolder(p);
              setMatterListCtx(null);
            }}
          >
            打开案件文件夹
          </button>
        ) : null}
      </LawmindMatterContextMenu>
    ) : null}
    </>
  );
});


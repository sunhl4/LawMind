/**
 * 案件工作台 — 列表、摘要、CASE 档案、任务/草稿/审计时间线、案件内搜索。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { apiGetJson, apiSendJson, messageFromOkFalseBody } from "../api-client";
import { openJobEventStream } from "../lawmind-job-stream";
import { LM_PANE_MAX_WIDTH_PX, LM_PANE_MIN_WIDTH_PX } from "../lawmind-panel-layout";
import { usePaneResizePx } from "../use-pane-resize";
import { useEdition } from "../use-edition";
import type { HistoryItem, TaskRow as ShellTaskRow } from "../lawmind-app-data";
import { RECORDS_DESK_UNLINKED } from "../lawmind-records-desk-state";
import { LawmindMatterContextMenu } from "../LawmindMatterContextMenu";
import { LawmindCreateMatterDialog } from "../LawmindCreateMatterDialog";
import {
  buildCaseFocusDraft,
  type CaseDraftVariant,
  type CaseFocusContext,
} from "./matter-case-focus";
import { useMatterPanelTab, useMatterWorkspaceAcceptance } from "./useMatterWorkbench";
import { MatterWorkbenchListPane } from "./MatterWorkbenchListPane";
import { useMatterSessionTimeline } from "./useMatterSessionTimeline";
import { useMatterProductIntelligence } from "./useMatterProductIntelligence";
import type { TaskBoardJobInput } from "./matter-task-board";

export type MatterWorkbenchHandle = {
  openCreateMatter: () => void;
};

import { useMatterWorkbenchOps } from "./useMatterWorkbenchOps";
import { useMatterInteractionEvidence } from "./useMatterInteractionEvidence";
import { sectionWriteTarget, type MatterSearchHit } from "./matter-interaction";
import { useMatterDetail } from "./useMatterDetail";
import { MatterWorkbenchMainPanels, type MatterWorkbenchMainPanelsProps } from "./MatterWorkbenchMainPanels";
import { matterMainPanelShell } from "./matter-workbench-main-panel-props";

type Props = {
  apiBase: string;
  refreshVersion?: number;
  assistantId?: string;
  /** 从文书台返回时由外壳一次性传入，用于恢复左侧选中的案件 */
  focusMatterId?: string | null;
  onFocusMatterIdApplied?: () => void;
  /** 在对话中带上案件 ID（matter 参数） */
  onUseInChat?: (matterId: string) => void;
  /** 从批准队列跳转到对应对话会话 */
  onOpenChatSession?: (sessionId: string, matterId?: string) => void;
  /** 打开文书台并预选相关草稿 */
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
  /** 打开「在办 → 按流程办」（任务看板空状态 CTA） */
  onOpenWorkflowLibrary?: () => void;
  /** 打开顶栏「会议室」并绑定本案 */
  onOpenTopLevelMeeting?: (matterId: string) => void;
  /** 打开「在办」待我拍板焦点 */
  onOpenNeedsDecisionDesk?: (
    target?: import("../lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
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
    onOpenTopLevelMeeting,
    onOpenNeedsDecisionDesk,
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
    profile,
    setProfile,
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
  const matterJobStreamsRef = useRef<Map<string, () => void>>(new Map());
  const [matterJobsTick, setMatterJobsTick] = useState(0);

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
  }, [apiBase, matterId, refreshVersion, matterJobsTick]);

  /** Live-refresh running/queued matter jobs via the same SSE as 在办. */
  useEffect(() => {
    if (!apiBase) {
      return;
    }
    const running = matterJobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .map((j) => j.jobId)
      .filter((id): id is string => Boolean(id?.trim()))
      .slice(0, 3);
    const wanted = new Set(running);
    for (const [jid, es] of matterJobStreamsRef.current.entries()) {
      if (!wanted.has(jid)) {
        es();
        matterJobStreamsRef.current.delete(jid);
      }
    }
    for (const jobId of running) {
      if (matterJobStreamsRef.current.has(jobId)) {
        continue;
      }
      const close = openJobEventStream({
        apiBase,
        jobId,
        onMessage: () => setMatterJobsTick((n) => n + 1),
        onError: () => {
          matterJobStreamsRef.current.get(jobId)?.();
          matterJobStreamsRef.current.delete(jobId);
        },
      });
      matterJobStreamsRef.current.set(jobId, close);
    }
    return () => {
      for (const es of matterJobStreamsRef.current.values()) {
        es();
      }
      matterJobStreamsRef.current.clear();
    };
  }, [apiBase, matterJobs]);

  const sessionTimeline = useMatterSessionTimeline(apiBase, matterId, panelTab, refreshVersion);

  const [showCreate, setShowCreate] = useState(false);
  const [matterListCtx, setMatterListCtx] = useState<{ x: number; y: number; matterId: string } | null>(null);
  const hasHandledRefreshRef = useRef(false);
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

  const {
    elevatedApprovals,
    filteredQueueItems,
    filteredApprovalRequests,
    filteredDrafts,
    reviewTargetForFocus,
  } = useMatterWorkbenchOps({ queueItems, approvalRequests, drafts, opsFocus, opsSort });

  const {
    recentMatterInteractions,
    matterInteractionSummary,
    logMatterInteraction,
    blockingExplanations,
    openReviewFromMatter,
    handleBlockingAction,
  } = useMatterInteractionEvidence({
    apiBase,
    matterId,
    auditEvents,
    setAuditEvents,
    queueItems,
    reviewTargetForFocus,
    onOpenReview,
    setPanelTab,
    setCaseFocusContext,
    setSearchQ,
    setSearchHits,
  });

  const productIntelligence = useMatterProductIntelligence({
    apiBase,
    assistantId,
    matterId,
    refreshVersion,
    showCrossMatterRoadmap,
    drafts,
    draftCitationByTask,
    matterInteractionSummary,
    blockingExplanations,
    caseFocusContext,
    logMatterInteraction,
    openReviewFromMatter,
    setPanelTab,
    setCaseFocusContext,
    setSearchQ,
    setSearchHits,
  });

  const {
    adoptedSuggestions,
    adoptionHistoryInsight,
    visiblePersistentAdoptions,
    convergenceSuggestions,
    productAdaptationSuggestions,
    productExperimentChecklist,
    crossMatterExperimentBoard,
    roadmapCandidates,
    roadmapPressureSummary,
    handleConvergenceSuggestion,
    pendingDrafts,
    modifiedDrafts,
    approvedDrafts,
  } = productIntelligence;

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

  useEffect(() => {
    setCaseFocusContext(null);
  }, [matterId]);

  useEffect(() => {
    setCaseDraftVariant("standard");
    setCaseDraftNote(caseFocusContext ? buildCaseFocusDraft(caseFocusContext, "standard") : "");
    setCaseActionMsg(null);
  }, [caseFocusContext]);

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

  const showMainPanels = (isUnlinkedBucket && showShellOps) || Boolean(matterId);
  const mainPanelShell = matterMainPanelShell({
    isUnlinkedBucket,
    showShellOps,
    matterId,
    detailLoading,
    detailError,
    summary,
    selectedOverview,
  });
  const mainPanelProps: MatterWorkbenchMainPanelsProps = {
    apiBase,
    ...mainPanelShell,
    profile: mainPanelShell.matterId ? profile : null,
    onProfileSaved: (next, statusLine) => {
      setProfile(next);
      if (statusLine && summary) {
        // refresh status line on cockpit header without full reload
        void loadDetail(next.matterId);
      }
    },
    assistantId,
    projectDir,
    panelTab,
    onSelectPanelTab: setPanelTab,
    onOpenTopLevelMeeting,
    onUseInChat,
    onOpenNeedsDecisionDesk,
    showShellOps,
    showWorkspaceAcceptanceDashboard,
    workspaceAcceptance,
    workspaceAcceptanceErr,
    matterOverviewExtrasOpen,
    setMatterOverviewExtrasOpen,
    reviewSummaryCards,
    onOpenReview,
    openReviewFromMatter,
    opsFocus,
    setOpsFocus,
    opsSort,
    setOpsSort,
    blockingExplanations,
    handleBlockingAction,
    queueItems,
    approvalRequests,
    matterInteractionSummary,
    showCrossMatterRoadmap,
    convergenceSuggestions,
    handleConvergenceSuggestion,
    productAdaptationSuggestions,
    productExperimentChecklist,
    crossMatterExperimentBoard,
    roadmapCandidates,
    adoptionHistoryInsight,
    visiblePersistentAdoptions,
    adoptedSuggestions,
    roadmapPressureSummary,
    recentMatterInteractions,
    filteredQueueItems,
    filteredApprovalRequests,
    filteredDrafts,
    draftCitationByTask,
    acceptanceByTask,
    caseFocusContext,
    caseDraftVariant,
    caseDraftNote,
    caseActionBusy,
    caseActionMsg,
    searchQ,
    searchBusy,
    searchHits,
    searchIndexMissing,
    coreIssues,
    riskNotes,
    artifacts,
    caseMemory,
    caseTruncated,
    coreIssuesRef,
    riskNotesRef,
    artifactsRef,
    caseMdRef,
    onClearCaseFocus: () => setCaseFocusContext(null),
    onCaseDraftVariantChange: setCaseDraftVariant,
    onCaseDraftNoteChange: setCaseDraftNote,
    onSearchQueryChange: setSearchQ,
    onRunSearch: () => void runSearch(),
    onWriteCaseFocusNote: () => void writeCaseFocusNote(),
    tasks,
    drafts,
    matterJobs,
    onOpenWorkflowLibrary,
    onOpenChatSession,
    progressEntries,
    sessionTimeline,
    auditEvents,
    productIntelligence,
    shellTasksScoped,
    shellHistoryScoped,
    shellAssistantDisplayById,
    shellLegalStatusLabel,
    shellTaskBadgeClass,
    shellHistoryBadgeClass,
    formatShellRelativeTime,
    onOpenShellDetail,
    onSelectPanelTabUnlinked: setPanelTab,
  };

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
        <MatterWorkbenchListPane
          workbenchListWidth={workbenchListWidth}
          onMatterListResize={onMatterListResize}
          loadingList={loadingList}
          listError={listError}
          overviews={overviews}
          internalSelectedId={internalSelectedId}
          onSelectMatter={(mid) => {
            setInternalSelectedId(mid);
            setPanelTab("overview");
          }}
          onRefreshList={() => void loadList()}
          onCreateMatter={() => setShowCreate(true)}
          canMatterContextMenu={
            Boolean(onUseInChat) ||
            Boolean(
              workspaceDir?.trim() &&
                typeof window !== "undefined" &&
                window.lawmindDesktop?.showItemInFolder,
            )
          }
          onMatterContextMenu={(e, mid) => {
            setMatterListCtx({ x: e.clientX, y: e.clientY, matterId: mid });
          }}
        />
      ) : null}

      <div className="lm-workbench-main">
        {!navKey && (
          <div className="lm-meta lm-workbench-placeholder">
            {isAppSidebar
              ? "在左侧 cases/ 目录或下方案件列表中选择案件"
              : "选择案件"}
          </div>
        )}

        {showMainPanels ? <MatterWorkbenchMainPanels {...mainPanelProps} /> : null}
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


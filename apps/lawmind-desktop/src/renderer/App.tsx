import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileWorkbench, type FileWorkbenchCasesNodeActions } from "./FileWorkbench";
import { MatterWorkbench } from "./MatterWorkbench";
import { ReviewWorkbench } from "./ReviewWorkbench";
import { HelpPanel } from "./HelpPanel";
import { LawmindApiSetupWizard } from "./LawmindApiSetupWizard";
import { LawmindAssistantEditorDialog } from "./lawmind-assistant-editor";
import { formatFileChatContextPill, useLawmindAppShell } from "./lawmind-app-shell";
import { LawmindChatSessionTabs } from "./LawmindChatSessionTabs";
import { LawmindChatMessagesColumn, LawmindChatComposeFooter } from "./lawmind-chat-shell";
import { LawmindDetailDialog } from "./lawmind-app-detail";
import { LawmindFirstRunDialog } from "./LawmindFirstRunDialog";
import { LawmindCreateMatterDialog } from "./LawmindCreateMatterDialog";
import { LawmindMatterRenameDialog, LawmindMatterDeleteDialog } from "./LawmindMatterRenameDeleteDialogs";
import { LawmindSettingsDialog } from "./lawmind-settings-shell";
import { LawmindCollaborationDesk, type CollaborationDeskTab } from "./LawmindCollaborationDesk";
import { useLawmindRecordsDeskMatters, RECORDS_DESK_UNLINKED } from "./lawmind-records-desk-state";
import { LawmindSidebar } from "./lawmind-sidebar";
import { useEdition } from "./use-edition";
import {
  shouldBounceSoloOffRoom,
  shouldEmbedSoloReviewRail,
  shouldReplaceWorkspaceWithMatterPage,
  shouldShowCollaborationTab,
  soloDeskSurfacePane,
  shouldShowComposePlanPicker,
  shouldShowEditionBadge,
  soloPrimaryTabLabel,
} from "./lawmind-solo-desk";
import {
  LM_PANE_MAX_WIDTH_PX,
  LM_PANE_MIN_WIDTH_PX,
  readStoredBool,
  writeStoredBool,
} from "./lawmind-panel-layout";
import { usePaneResizePx } from "./use-pane-resize";
import { apiGetJson, apiSendJson, errorMessage, messageFromOkFalseBody } from "./api-client";
import { displayNameFromImportBasename, suggestMatterIdForImport } from "../../../../src/lawmind/cases/matter-label.ts";
import { useLawyerReviewDesktopNotify } from "./lawmind-lawyer-review-notify";
import { sidecarInboxBannerText } from "./lawmind-sidecar-inbox";
import { useSidecarInbox } from "./use-sidecar-inbox";
import { scaffoldChatBannerText } from "./lawmind-scaffold-copy";
import { useLatestScaffoldDraft } from "./use-latest-scaffold";

function resolveWorkspacePath(workspaceDir: string, rel: string): string {
  const r = rel.replace(/\\/g, "/").replace(/^\//, "");
  const w = workspaceDir.replace(/\\/g, "/").replace(/\/$/, "");
  return `${w}/${r}`;
}

/** Relative path for GET /api/artifact?path= (must stay under workspace `artifacts/`) */
function artifactApiRelFromOutput(outputPath?: string): string | null {
  if (!outputPath) {
    return null;
  }
  const norm = outputPath.replace(/\\/g, "/").replace(/^\//, "");
  if (norm.startsWith("artifacts/")) {
    return norm;
  }
  if (!norm.includes("/")) {
    return `artifacts/${norm}`;
  }
  return null;
}

function formatLocaleDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) {
      return iso;
    }
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) {
      return "刚刚";
    }
    if (diff < 3_600_000) {
      return `${Math.floor(diff / 60_000)} 分钟前`;
    }
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d >= today) {
      return `今天 ${hhmm}`;
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d >= yesterday) {
      return `昨天 ${hhmm}`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return iso;
  }
}

function legalStatusLabel(status: string | undefined, kind?: string): string {
  if (kind === "agent.instruction") {
    return "对话";
  }
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "done" || normalized === "completed") {
    return "已完成";
  }
  if (normalized === "running" || normalized === "processing") {
    return "处理中";
  }
  if (normalized === "error" || normalized === "failed") {
    return "处理失败";
  }
  if (normalized === "pending") {
    return "待处理";
  }
  if (normalized === "draft") {
    return "草稿";
  }
  if (normalized === "task") {
    return "任务";
  }
  return status ?? "任务";
}

function taskBadgeClass(status: string, kind?: string): string {
  if (kind === "agent.instruction") {
    return "lm-badge lm-badge-chat";
  }
  const normalized = status.toLowerCase();
  if (normalized === "done" || normalized === "completed") {
    return "lm-badge lm-badge-done";
  }
  if (normalized === "running" || normalized === "processing") {
    return "lm-badge lm-badge-running";
  }
  if (normalized === "error" || normalized === "failed") {
    return "lm-badge lm-badge-error";
  }
  return "lm-badge";
}

function historyBadgeClass(kind: string, taskRecordKind?: string, status?: string): string {
  if (kind === "draft") {
    return "lm-badge lm-badge-draft";
  }
  if (taskRecordKind === "agent.instruction") {
    return "lm-badge lm-badge-chat";
  }
  if (status) {
    return taskBadgeClass(status);
  }
  return "lm-badge";
}

export function App() {
  const {
    state,
    derived,
    actions,
  } = useLawmindAppShell();

  const {
    mainView,
    reviewFocusTaskId,
    reviewFocusMatterId,
    reviewFocusStatus,
    reviewFocusListMode,
    matterRefreshVersion,
    config,
    health,
    showWizard,
    wizApiKey,
    wizBaseUrl,
    wizModel,
    wizWorkspace,
    wizBusy,
    wizError,
    wizRetrievalMode,
    retrievalSaving,
    sideTab,
    taskListQuery,
    listTimeRange,
    tasks,
    history,
    assistants,
    presets,
    selectedAssistantId,
    showAssistantEditor,
    editingAssistantId,
    assistantDraft,
    asstBusy,
    asstError,
    input,
    loading,
    error,
    detailOpen,
    detailKind,
    detailId,
    detailLoading,
    detailError,
    detailTask,
    detailDraft,
    detailCitationIntegrity,
    detailCheckpoints,
    detailExecutionPlan,
    contextTaskId,
    contextMatterId,
    fileChatContextItems,
    copiedMessageIndex,
    recordsExpanded,
    showSettings,
    showHelp,
    collabSummarySettings,
    collabExpanded,
    delegations,
    collabEvents,
    collabTab,
    currentMessages,
    chatSessionList,
    chatSessionsLoading,
    activeChatSessionId,
  } = state;

  const {
    canUseFilesystemBridge,
    projectDir,
    filteredTasks,
    filteredHistory,
    selectedAssistant,
    selectedAssistantStats,
    workspaceLabel,
    retrievalLabel,
    currentMatterLabel,
  } = derived;

  const recordsDeskMatters = useLawmindRecordsDeskMatters({
    enabled: mainView === "workspace" && Boolean(config),
    apiBase: config?.apiBase ?? "",
    matterRefreshVersion,
    tasks,
    history,
  });
  const [matterImportBusy, setMatterImportBusy] = useState(false);
  const [matterCockpitOpen, setMatterCockpitOpen] = useState(false);
  const [wsShowEditor, setWsShowEditor] = useState(() => readStoredBool("lawmind.ui.wsPaneEditor", true));
  const [wsShowChat, setWsShowChat] = useState(() => readStoredBool("lawmind.ui.wsPaneChat", true));
  const [createMatterOpen, setCreateMatterOpen] = useState(false);
  const [matterRenameOpen, setMatterRenameOpen] = useState<{ matterId: string; initialTitle: string } | null>(
    null,
  );
  const [matterDeleteOpen, setMatterDeleteOpen] = useState<{ matterId: string; label: string } | null>(null);

  useEffect(() => {
    if (mainView !== "workspace") {
      setMatterCockpitOpen(false);
    }
  }, [mainView]);

  const matterLabelById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const row of recordsDeskMatters.sidebarRowsAll) {
      if (row.matterId) {
        m[row.matterId] = row.title;
      }
    }
    return m;
  }, [recordsDeskMatters.sidebarRowsAll]);

  const importMattersFromUserFiles = useCallback(async () => {
    const api = config?.apiBase;
    const desk = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
    const dlg = desk?.openFilesDialog;
    if (!api?.trim()) {
      void desk?.showNotification?.({
        title: "LawMind",
        body: "请先完成连接设置，确保本地 API 可用后再导入案件。",
      });
      return;
    }
    if (!dlg) {
      void desk?.showNotification?.({
        title: "LawMind",
        body: "当前页面未注入桌面桥接，请使用 LawMind 桌面应用导入。",
      });
      return;
    }
    setMatterImportBusy(true);
    try {
      let r: Awaited<ReturnType<NonNullable<typeof dlg>>>;
      try {
        r = await dlg({
          title: "所选每一文件或文件夹将各自创建一个案件（展示名取自名称）",
          multi: true,
          allowDirectories: true,
        });
      } catch (e) {
        void desk?.showNotification?.({
          title: "LawMind",
          body: errorMessage(e, "无法打开文件选择"),
        });
        return;
      }
      if (!r.ok || !r.filePaths?.length || r.canceled) {
        return;
      }
      let lastOkId: string | undefined;
      for (let i = 0; i < r.filePaths.length; i++) {
        const fp = r.filePaths[i];
        const kind = r.pathKinds?.[i] ?? "file";
        const displayName = displayNameFromImportBasename(fp, {
          treatAsDirectory: kind === "directory",
        });
        const matterId = suggestMatterIdForImport(fp, i, {
          treatAsDirectory: kind === "directory",
        });
        try {
          const j = await apiSendJson<
            { ok?: boolean; error?: string; matterId?: string },
            { matterId: string; displayName?: string }
          >(api, "/api/matters/create", "POST", { matterId, displayName });
          if (j.ok && typeof j.matterId === "string") {
            lastOkId = j.matterId;
          }
        } catch (e) {
          console.warn(errorMessage(e, "导入案件"));
        }
      }
      setMatterRefreshVersion((v) => v + 1);
      if (lastOkId) {
        recordsDeskMatters.setSelectedKey(lastOkId);
      } else if (r.filePaths.length > 0) {
        void desk?.showNotification?.({
          title: "LawMind",
          body: "未能创建案件（可能网络或服务异常）。请查看开发工具控制台或稍后重试。",
        });
      }
    } finally {
      setMatterImportBusy(false);
    }
  }, [config?.apiBase, recordsDeskMatters.setSelectedKey]);

  const [chatMatterHeadline, setChatMatterHeadline] = useState<string | null>(null);
  /** 左栏：资源树 portal；主区：仅编辑器 */
  const [fileExplorerHost, setFileExplorerHost] = useState<HTMLDivElement | null>(null);
  const [fileEditorHost, setFileEditorHost] = useState<HTMLDivElement | null>(null);
  /** 从审核台点「返回案件」时一次性选中左侧案件，避免掉上下文 */
  const [focusMatterIdFromReview, setFocusMatterIdFromReview] = useState<string | null>(null);
  /** 从案件点「去复核」进入审核时为 true，点顶栏「审核」为 false，用于是否显示「返回案件」 */
  const [reviewLaunchedFromMatter, setReviewLaunchedFromMatter] = useState(false);
  /** 顶栏「协作」内分栏：状态一览 / 团队工作流 */
  const [collaborationDeskTab, setCollaborationDeskTab] = useState<CollaborationDeskTab>("overview");
  /** Solo：改稿嵌在工作台右轨，不切独立审核页 */
  const [soloReviewRail, setSoloReviewRail] = useState(false);

  useEffect(() => {
    const id = focusMatterIdFromReview?.trim();
    if (!id) {
      return;
    }
    recordsDeskMatters.setSelectedKey(id);
    setFocusMatterIdFromReview(null);
  }, [focusMatterIdFromReview, recordsDeskMatters.setSelectedKey]);

  useEffect(() => {
    if (!config?.apiBase || !contextMatterId?.trim()) {
      setChatMatterHeadline(null);
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          summary?: { headline?: string };
        }>(config.apiBase, `/api/matters/detail?matterId=${encodeURIComponent(contextMatterId)}`);
        if (cancel) {
          return;
        }
        if (!j.ok) {
          setChatMatterHeadline(null);
          return;
        }
        const h = typeof j.summary?.headline === "string" ? j.summary.headline.trim() : "";
        setChatMatterHeadline(h || null);
      } catch {
        if (!cancel) {
          setChatMatterHeadline(null);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [config?.apiBase, contextMatterId, matterRefreshVersion]);

  const {
    setMainView,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setMatterRefreshVersion,
    setShowWizard,
    setWizApiKey,
    setWizBaseUrl,
    setWizModel,
    setWizRetrievalMode,
    setSideTab,
    setTaskListQuery,
    setListTimeRange,
    setSelectedAssistantId,
    setShowAssistantEditor,
    setAssistantDraft,
    setInput,
    setContextTaskId,
    setContextMatterId,
    setRecordsExpanded,
    setShowSettings,
    setShowHelp,
    setCollabExpanded,
    setCollabTab,
    refreshLists,
    refreshCollaboration,
    openDetail,
    closeDetail,
    applyRetrievalMode,
    runWizardSave,
    pickWs,
    pickProject,
    clearProject,
    send,
    abortChatSend,
    sendChatMessage,
    openNewAssistant,
    openEditAssistant,
    saveAssistant,
    removeAssistant,
    copyMessage,
    openApiWizard,
    clearContext,
    addFileToChatContext,
    removeFileChatContextItem,
    clearFileChatContext,
    selectChatSession,
    openDelegationTargetWorkspaceChat,
    createNewChatSession,
    renameChatSession,
    deleteChatSession,
  } = actions;

  const linkMatterToChat = useCallback(
    (matterId: string) => {
      setContextMatterId(matterId);
      setMatterCockpitOpen(false);
      setMainView("workspace");
    },
    [setContextMatterId, setMainView],
  );

  const setCaseSubdirRole = useCallback(
    async (matterId: string, role: "matter" | "folder") => {
      const api = config?.apiBase?.trim();
      if (!api) {
        return;
      }
      try {
        const j = await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string; role: string }>(
          api,
          "/api/matters/role",
          "POST",
          { matterId, role },
        );
        if (!j.ok) {
          console.warn(messageFromOkFalseBody(j, "更新节点角色失败"));
          return;
        }
        setMatterRefreshVersion((v) => v + 1);
      } catch (e) {
        console.warn(errorMessage(e, "更新节点角色失败"));
      }
    },
    [config?.apiBase, setMatterRefreshVersion],
  );

  const workspaceCasesMenu = useMemo((): FileWorkbenchCasesNodeActions | null => {
    if (!config?.apiBase?.trim()) {
      return null;
    }
    return {
      apiBase: config.apiBase,
      workspaceDir: config.workspaceDir ?? null,
      matterLabelById,
      onOpenMatterCockpit: (matterId) => {
        recordsDeskMatters.setSelectedKey(matterId);
        setMatterCockpitOpen(true);
      },
      onLinkMatterToChat: linkMatterToChat,
      onRequestRenameDisplayName: (mid, initialTitle) => {
        setMatterRenameOpen({ matterId: mid, initialTitle });
      },
      onRequestDeleteMatter: (mid, label) => {
        setMatterDeleteOpen({ matterId: mid, label });
      },
      onSetCaseSubdirRole: setCaseSubdirRole,
      onNewMatter: () => setCreateMatterOpen(true),
      onImportMatters: () => void importMattersFromUserFiles(),
      onRefreshMatters: () => setMatterRefreshVersion((v) => v + 1),
      importMattersBusy: matterImportBusy,
      canImportMatters: Boolean(
        typeof window !== "undefined" && window.lawmindDesktop?.openFilesDialog,
      ),
    };
  }, [
    config,
    matterLabelById,
    matterImportBusy,
    importMattersFromUserFiles,
    recordsDeskMatters.setSelectedKey,
    linkMatterToChat,
    setCaseSubdirRole,
    setMatterRefreshVersion,
    setCreateMatterOpen,
  ]);

  const fileWorkbenchMattersPickList = useMemo(() => {
    const rows = recordsDeskMatters.sidebarRowsAll.filter(
      (r) => Boolean(r.matterId) && r.key !== RECORDS_DESK_UNLINKED,
    );
    const seen = new Set<string>();
    const out: Array<{ id: string; label: string }> = [];
    for (const r of rows) {
      const id = r.matterId as string;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      out.push({ id, label: r.title });
    }
    return out;
  }, [recordsDeskMatters.sidebarRowsAll]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const edition = useEdition(config?.apiBase ?? "");
  const soloDesk = shouldEmbedSoloReviewRail(edition.edition);
  const showCollabTab = shouldShowCollaborationTab(edition.edition);
  const soloSurface = soloDeskSurfacePane({
    edition: edition.edition,
    reviewRail: soloReviewRail,
    matterOpen: matterCockpitOpen,
  });
  const showFirmMatterPage = shouldReplaceWorkspaceWithMatterPage(edition.edition, matterCockpitOpen);
  const sidecarInbox = useSidecarInbox(config?.apiBase, edition.features.wordSidecar);
  const scaffoldDraft = useLatestScaffoldDraft(config?.apiBase, soloSurface === "chat");

  const openDeskReview = useCallback(
    (opts?: {
      taskId?: string | null;
      matterId?: string | null;
      statusFilter?: typeof reviewFocusStatus;
      listMode?: typeof reviewFocusListMode;
      fromMatter?: boolean;
    }) => {
      setReviewFocusTaskId(opts?.taskId ?? null);
      setReviewFocusMatterId(opts?.matterId ?? null);
      setReviewFocusStatus(opts?.statusFilter ?? "all");
      setReviewFocusListMode(opts?.listMode ?? "pending");
      setReviewLaunchedFromMatter(Boolean(opts?.fromMatter));
      if (opts?.matterId) {
        setContextMatterId(opts.matterId);
      }
      if (shouldEmbedSoloReviewRail(edition.edition)) {
        setSoloReviewRail(true);
        if (!opts?.fromMatter) {
          setMatterCockpitOpen(false);
        }
        setWsShowChat(true);
        if (canUseFilesystemBridge) {
          setWsShowEditor(true);
        }
        setMainView("workspace");
        return;
      }
      setSoloReviewRail(false);
      setMainView("review");
    },
    [canUseFilesystemBridge, edition.edition, setContextMatterId, setMainView],
  );

  useEffect(() => {
    const unsub = window.lawmindDesktop?.onNotificationClick?.((payload) => {
      if (payload?.reason === "open_review") {
        openDeskReview({
          taskId: payload.reviewTaskId?.trim() ? payload.reviewTaskId : null,
          matterId: payload.reviewMatterId?.trim() ? payload.reviewMatterId : null,
          statusFilter: "pending",
          listMode: "pending",
          fromMatter: false,
        });
        return;
      }
      if (payload?.reason === "open_workspace_chat") {
        setMainView("workspace");
        const aid = payload.chatAssistantId?.trim();
        if (aid && assistants.some((a) => a.assistantId === aid)) {
          setSelectedAssistantId(aid);
        }
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[aria-label="对话消息"]')?.scrollIntoView({
            behavior: "smooth",
            block: "end",
          });
        });
        return;
      }
      if (payload?.reason !== "open_settings_collaboration") {
        return;
      }
      setShowSettings(false);
      setCollaborationDeskTab("workflows");
      setMainView("collaboration");
      requestAnimationFrame(() => {
        document.getElementById("lawmind-collaboration-hub")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    });
    return () => {
      unsub?.();
    };
  }, [
    assistants,
    openDeskReview,
    setMainView,
    setCollaborationDeskTab,
    setReviewFocusListMode,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusTaskId,
    setSelectedAssistantId,
    setShowSettings,
  ]);

  useLawyerReviewDesktopNotify({
    tasks,
    history,
    enabled: typeof window !== "undefined" && Boolean(window.lawmindDesktop?.showNotification),
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredBool("lawmind.ui.sidebarCollapsed", false),
  );

  useEffect(() => {
    writeStoredBool("lawmind.ui.sidebarCollapsed", sidebarCollapsed);
  }, [sidebarCollapsed]);

  const { width: sidebarWidth, onResizePointerDown: onSidebarResizePointerDown } = usePaneResizePx({
    storageKey: "lawmind.ui.sidebarWidth",
    defaultWidth: 282,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
    widthRole: "shellSidebar",
  });

  useEffect(() => {
    writeStoredBool("lawmind.ui.wsPaneEditor", wsShowEditor);
  }, [wsShowEditor]);
  useEffect(() => {
    writeStoredBool("lawmind.ui.wsPaneChat", wsShowChat);
  }, [wsShowChat]);

  const { width: wsChatColWidth, onResizePointerDown: onWsChatSplitResize } = usePaneResizePx({
    storageKey: "lawmind.ui.wsChatColumnWidth",
    defaultWidth: 380,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  useEffect(() => {
    if (mainView === "collaboration") {
      setCollabExpanded(true);
    }
  }, [mainView, setCollabExpanded]);

  useEffect(() => {
    if (edition.loading || !shouldBounceSoloOffRoom(edition.edition, mainView)) {
      return;
    }
    if (mainView === "review") {
      setSoloReviewRail(true);
      setMatterCockpitOpen(false);
      setWsShowChat(true);
      if (canUseFilesystemBridge) {
        setWsShowEditor(true);
      }
    }
    setMainView("workspace");
  }, [canUseFilesystemBridge, edition.edition, edition.loading, mainView, setMainView]);

  /** 审核页也需左栏材料树；此前仅工作台挂载 FileWorkbench，导致切到审核后左栏被卸掉。 */
  const showSidebarWorkbenchFiles =
    canUseFilesystemBridge && (mainView === "workspace" || mainView === "review");

  const previewArtifact = (outputPath?: string) => {
    if (!config) {
      return;
    }
    const rel = artifactApiRelFromOutput(outputPath);
    if (!rel) {
      return;
    }
    const url = `${config.apiBase}/api/artifact?path=${encodeURIComponent(rel)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openOutputInFolder = (outputPath?: string) => {
    if (!config || !outputPath || !canUseFilesystemBridge) {
      return;
    }
    const full = resolveWorkspacePath(config.workspaceDir, outputPath);
    void window.lawmindDesktop?.showItemInFolder?.(full);
  };

  const openSoloMatterRail = useCallback(() => {
    setSoloReviewRail(false);
    setMatterCockpitOpen(true);
    setWsShowChat(true);
    setMainView("workspace");
  }, [setMainView]);

  const matterWorkbenchNode =
    config ? (
      <MatterWorkbench
        apiBase={config.apiBase}
        refreshVersion={matterRefreshVersion}
        assistantId={selectedAssistantId}
        matterListPlacement="app-sidebar"
        selectedMatterKey={recordsDeskMatters.selectedKey}
        shellTasks={tasks}
        shellHistory={history}
        onOpenShellDetail={(kind, id) => void openDetail(kind, id)}
        formatShellRelativeTime={formatRelativeTime}
        shellAssistantDisplayById={Object.fromEntries(
          assistants.map((a) => [a.assistantId, a.displayName]),
        )}
        shellLegalStatusLabel={legalStatusLabel}
        shellTaskBadgeClass={taskBadgeClass}
        shellHistoryBadgeClass={historyBadgeClass}
        onMatterCreated={(matterId) => {
          setMatterRefreshVersion((v) => v + 1);
          recordsDeskMatters.setSelectedKey(matterId);
        }}
        workspaceDir={config.workspaceDir ?? null}
        projectDir={projectDir}
        onUseInChat={linkMatterToChat}
        onOpenReview={({ taskId, matterId, statusFilter = "all", listMode = "all" }) => {
          openDeskReview({
            taskId,
            matterId,
            statusFilter,
            listMode,
            fromMatter: true,
          });
        }}
      />
    ) : null;

  return (
    <div className="lm-shell">
      {showWizard && (
        <LawmindApiSetupWizard
          wizApiKey={wizApiKey}
          setWizApiKey={setWizApiKey}
          wizBaseUrl={wizBaseUrl}
          setWizBaseUrl={setWizBaseUrl}
          wizModel={wizModel}
          setWizModel={setWizModel}
          wizWorkspace={wizWorkspace}
          wizRetrievalMode={wizRetrievalMode}
          setWizRetrievalMode={setWizRetrievalMode}
          wizError={wizError}
          wizBusy={wizBusy}
          onPickWorkspace={() => void pickWs()}
          onCancel={() => setShowWizard(false)}
          onSave={() => void runWizardSave()}
        />
      )}
      <LawmindDetailDialog
        open={detailOpen}
        detailKind={detailKind}
        detailId={detailId}
        detailLoading={detailLoading}
        detailError={detailError}
        detailTask={detailTask}
        detailDraft={detailDraft}
        detailCitationIntegrity={detailCitationIntegrity}
        detailCheckpoints={detailCheckpoints}
        detailExecutionPlan={detailExecutionPlan}
        canUseFilesystemBridge={canUseFilesystemBridge}
        apiBase={config?.apiBase}
        onClose={closeDetail}
        onPreviewArtifact={previewArtifact}
        onOpenOutputInFolder={openOutputInFolder}
        onUseTaskContext={(taskId, matterId) => {
          setContextTaskId(taskId);
          setContextMatterId(matterId);
          closeDetail();
        }}
        formatLocaleDateTime={formatLocaleDateTime}
        artifactApiRelFromOutput={artifactApiRelFromOutput}
      />
      <LawmindAssistantEditorDialog
        open={showAssistantEditor}
        editingAssistantId={editingAssistantId}
        draft={assistantDraft}
        presets={presets}
        assistantLinkOptions={assistants
          .filter((a) => a.assistantId !== editingAssistantId)
          .map((a) => ({ assistantId: a.assistantId, displayName: a.displayName }))}
        busy={asstBusy}
        error={asstError}
        onChange={setAssistantDraft}
        onClose={() => setShowAssistantEditor(false)}
        onSave={() => void saveAssistant()}
      />
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      <LawmindFirstRunDialog
        apiBase={config?.apiBase ?? ""}
        onClose={() => {
          /* dismiss handled inside the dialog */
        }}
        onSeedReady={({ matterId, seedPrompt }) => {
          setContextMatterId(matterId);
          setInput(seedPrompt);
          textareaRef.current?.focus();
        }}
      />
      <LawmindSettingsDialog
        open={showSettings}
        config={config}
        projectDir={projectDir}
        workspaceLabel={workspaceLabel}
        health={health}
        collabSummarySettings={collabSummarySettings}
        assistants={assistants}
        selectedAssistantId={selectedAssistantId}
        onSelectAssistantId={setSelectedAssistantId}
        selectedAssistant={selectedAssistant}
        selectedAssistantStats={selectedAssistantStats}
        retrievalLabel={retrievalLabel}
        retrievalSaving={retrievalSaving}
        onClose={() => setShowSettings(false)}
        onOpenNewAssistant={openNewAssistant}
        onOpenEditAssistant={openEditAssistant}
        onRemoveAssistant={() => void removeAssistant()}
        onApplyRetrievalMode={applyRetrievalMode}
        onOpenApiWizard={openApiWizard}
        onPickProject={() => void pickProject()}
        onClearProject={() => void clearProject()}
        onOpenCollaborationPage={() => {
          setCollaborationDeskTab("overview");
          setMainView("collaboration");
        }}
        edition={edition.edition}
      />
      <aside
        className={`lm-side ${sidebarCollapsed ? "lm-side-collapsed" : ""} ${
          showSidebarWorkbenchFiles ? "lm-side-with-workbench-files" : ""
        }`}
        style={{
          width: sidebarCollapsed ? 0 : sidebarWidth,
          flexShrink: 0,
          borderRight: sidebarCollapsed ? "none" : undefined,
        }}
        aria-hidden={sidebarCollapsed}
      >
        <div className="lm-brand">
          <div className="lm-logo-mark">L</div>
          <div className="lm-brand-copy">
            <div className="lm-brand-title">LawMind</div>
            <div className="lm-brand-subtitle">{soloDesk ? "Desk" : "Firm"}</div>
          </div>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={() => setShowHelp(true)}
            aria-label="帮助"
            title="帮助"
          >
            ?
          </button>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={() => setShowSettings(true)}
            aria-label="设置"
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6.5.75h3l.3 1.77a5.5 5.5 0 0 1 1.28.74l1.72-.58 1.5 2.6-1.42 1.19a5.6 5.6 0 0 1 0 1.06l1.42 1.19-1.5 2.6-1.72-.58a5.5 5.5 0 0 1-1.28.74l-.3 1.77h-3l-.3-1.77a5.5 5.5 0 0 1-1.28-.74l-1.72.58-1.5-2.6 1.42-1.19a5.6 5.6 0 0 1 0-1.06L1.7 5.28l1.5-2.6 1.72.58a5.5 5.5 0 0 1 1.28-.74L6.5.75Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        </div>
        {showSidebarWorkbenchFiles ? (
          <div
            ref={setFileExplorerHost}
            className="lm-side-explorer-host"
            aria-label="材料资源树"
          />
        ) : null}
        <div className="lm-side-stack">
          <LawmindSidebar
            projectDir={projectDir}
            assistants={assistants}
            selectedAssistantId={selectedAssistantId}
            showAssistantSelector={false}
            variant="project-only"
            recordsExpanded={recordsExpanded}
            collabExpanded={collabExpanded}
            collabTab={collabTab}
            sideTab={sideTab}
            taskListQuery={taskListQuery}
            listTimeRange={listTimeRange}
            filteredTasks={filteredTasks}
            filteredHistory={filteredHistory}
            delegations={delegations}
            collabEvents={collabEvents}
            onSelectAssistantId={setSelectedAssistantId}
            onToggleRecordsExpanded={() => setRecordsExpanded((value) => !value)}
            onToggleCollabExpanded={() => setCollabExpanded((value) => !value)}
            onSelectCollabTab={setCollabTab}
            onSelectSideTab={setSideTab}
            onTaskListQueryChange={setTaskListQuery}
            onListTimeRangeChange={setListTimeRange}
            onOpenDetail={(kind, id) => void openDetail(kind, id)}
            onOpenDelegationTargetChat={(d) => void openDelegationTargetWorkspaceChat(d)}
            formatRelativeTime={formatRelativeTime}
            legalStatusLabel={legalStatusLabel}
            taskBadgeClass={taskBadgeClass}
            historyBadgeClass={historyBadgeClass}
          />
        </div>
      </aside>
      {!sidebarCollapsed ? (
        <div
          className="lm-split-handle lm-split-handle-vertical"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左栏宽度"
          title="拖动调整侧栏宽度"
          onPointerDown={onSidebarResizePointerDown}
        />
      ) : null}
      <main className="lm-main">
        <div className="lm-main-header lm-main-header-compact">
          <div className="lm-main-title-block">
            <div className="lm-main-assistant-line">
              {assistants.length > 1 ? (
                <select
                  className="lm-asst-select lm-main-asst-select"
                  value={selectedAssistantId}
                  aria-label="选择助手"
                  onChange={(e) => setSelectedAssistantId(e.target.value)}
                >
                  {assistants.map((assistant) => (
                    <option key={assistant.assistantId} value={assistant.assistantId}>
                      {assistant.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="lm-main-assistant-name">
                  {selectedAssistant?.displayName ?? "LawMind"}
                </span>
              )}
            </div>
          </div>
          <nav className="lm-tabs lm-main-nav lm-main-nav-compact" aria-label="功能模块">
            <button
              type="button"
              className={`lm-tab ${mainView === "workspace" && soloSurface === "chat" ? "active" : ""}`}
              aria-current={mainView === "workspace" && soloSurface === "chat" ? "page" : undefined}
              onClick={() => {
                setSoloReviewRail(false);
                if (soloDesk) {
                  setMatterCockpitOpen(false);
                }
                setMainView("workspace");
              }}
            >
              {soloDesk ? soloPrimaryTabLabel("workspace") : "工作台"}
            </button>
            {showCollabTab ? (
              <button
                type="button"
                className={`lm-tab ${mainView === "collaboration" ? "active" : ""}`}
                aria-current={mainView === "collaboration" ? "page" : undefined}
                onClick={() => {
                  setCollaborationDeskTab("overview");
                  setMainView("collaboration");
                }}
              >
                协作
              </button>
            ) : null}
            <button
              type="button"
              className={`lm-tab ${mainView === "review" || soloReviewRail ? "active" : ""}`}
              aria-current={mainView === "review" || soloReviewRail ? "page" : undefined}
              onClick={() => {
                openDeskReview({ fromMatter: false, listMode: "pending" });
              }}
            >
              {soloDesk ? soloPrimaryTabLabel("review") : "审核"}
            </button>
          </nav>
          <div className="lm-header-spacer" aria-hidden />
          <div className="lm-panel-toggles" role="toolbar" aria-label="主区面板（工作台）">
            <button
              type="button"
              className={`lm-panel-toggle ${sidebarCollapsed ? "lm-panel-toggle-off" : ""}`}
              title={sidebarCollapsed ? "显示左侧栏（品牌与材料资源树）" : "隐藏左侧栏"}
              aria-pressed={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              <span className="lm-panel-toggle-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="9" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
                </svg>
              </span>
              <span className="lm-panel-toggle-label">左栏</span>
            </button>
            <button
              type="button"
              className={`lm-panel-toggle ${!wsShowEditor ? "lm-panel-toggle-off" : ""}`}
              title={wsShowEditor ? "隐藏编辑器" : "显示编辑器"}
              aria-pressed={wsShowEditor}
              disabled={!canUseFilesystemBridge || mainView !== "workspace"}
              onClick={() => {
                if (mainView === "workspace" && canUseFilesystemBridge) {
                  setWsShowEditor((v) => !v);
                }
              }}
            >
              <span className="lm-panel-toggle-label">编辑</span>
            </button>
            <button
              type="button"
              className={`lm-panel-toggle ${!wsShowChat ? "lm-panel-toggle-off" : ""}`}
              title={wsShowChat ? "隐藏对话区" : "显示对话区"}
              aria-pressed={wsShowChat}
              disabled={mainView !== "workspace"}
              onClick={() => {
                if (mainView === "workspace") {
                  setWsShowChat((v) => !v);
                }
              }}
            >
              <span className="lm-panel-toggle-label">对话</span>
            </button>
          </div>
          {projectDir && (
            <div className="lm-header-meta lm-header-project" title={projectDir}>
              {projectDir.split(/[\\/]/).filter(Boolean).pop()}
            </div>
          )}
          {currentMatterLabel && <div className="lm-header-meta">案件 {currentMatterLabel}</div>}
          {!edition.loading && shouldShowEditionBadge(edition.edition) ? (
            <div
              className={`lm-header-meta lm-edition-badge lm-edition-${edition.edition}`}
              title={`版本来源：${edition.source}`}
            >
              {edition.label}
            </div>
          ) : null}
        </div>
        <div className="lm-main-body">
          {showFirmMatterPage && config ? (
            <div className="lm-main-workbench">{matterWorkbenchNode}</div>
          ) : !soloDesk && mainView === "review" && config ? (
            <div className="lm-main-workbench">
              <ReviewWorkbench
                apiBase={config.apiBase}
                assistantId={selectedAssistantId}
                initialTaskId={reviewFocusTaskId}
                initialMatterId={reviewFocusMatterId}
                initialStatusFilter={reviewFocusStatus}
                initialListMode={reviewFocusListMode}
                returnMatterId={reviewLaunchedFromMatter ? reviewFocusMatterId : null}
                onReturnToMatter={() => {
                  if (reviewFocusMatterId) {
                    setFocusMatterIdFromReview(reviewFocusMatterId);
                  }
                  setReviewLaunchedFromMatter(false);
                  setMainView("workspace");
                  setMatterCockpitOpen(true);
                }}
                onShowArtifact={(relPath) => openOutputInFolder(relPath)}
                onRecordsChanged={() => {
                  setMatterRefreshVersion((v) => v + 1);
                  void refreshLists();
                }}
              />
            </div>
          ) : !soloDesk && mainView === "collaboration" ? (
            <div className="lm-main-workbench lm-desk-page lm-desk-page-collab">
              <div className="lm-side-scroll lm-desk-page-scroll lm-collab-page-stack">
                <LawmindCollaborationDesk
                  config={config}
                  collabSummarySettings={collabSummarySettings}
                  selectedAssistantId={selectedAssistantId}
                  delegations={delegations}
                  collabEvents={collabEvents}
                  collabTab={collabTab}
                  onSelectCollabTab={setCollabTab}
                  formatRelativeTime={formatRelativeTime}
                  onRefreshCollaboration={refreshCollaboration}
                  onOpenDelegationTargetChat={(d) => void openDelegationTargetWorkspaceChat(d)}
                  deskTab={collaborationDeskTab}
                  onDeskTabChange={setCollaborationDeskTab}
                />
              </div>
            </div>
          ) : (
            <div className="lm-workspace-unified lm-cursor-workspace">
              <div className="lm-cursor-panes-row">
                {canUseFilesystemBridge ? (
                  <div
                    ref={setFileEditorHost}
                    className="lm-cursor-pane-editor-host lm-file-editor-host"
                    style={{
                      display: wsShowEditor ? "flex" : "none",
                      flexDirection: "column",
                      flex: wsShowEditor ? "1 1 0%" : "0 0 0",
                      minHeight: 0,
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  />
                ) : null}
                {canUseFilesystemBridge && wsShowEditor && wsShowChat ? (
                  <div
                    className="lm-split-handle lm-split-handle-vertical"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="调整编辑器与对话区宽度"
                    title="拖动调整对话区宽度"
                    onPointerDown={onWsChatSplitResize}
                  />
                ) : null}
                {wsShowChat ? (
                  <div
                    className="lm-cursor-chat-pane"
                    style={{
                      width:
                        canUseFilesystemBridge && wsShowEditor ? wsChatColWidth : undefined,
                      flex: !canUseFilesystemBridge || !wsShowEditor ? 1 : undefined,
                      flexShrink: canUseFilesystemBridge && wsShowEditor ? 0 : undefined,
                      minWidth: 0,
                      minHeight: 0,
                    }}
                  >
                    <div className="lm-chat-workspace lm-chat-workspace-messages-only">
                      {soloSurface === "review" && config ? (
                        <div className="lm-solo-review-rail" data-testid="lm-solo-review-rail">
                          <ReviewWorkbench
                            apiBase={config.apiBase}
                            assistantId={selectedAssistantId}
                            initialTaskId={reviewFocusTaskId}
                            initialMatterId={reviewFocusMatterId}
                            initialStatusFilter={reviewFocusStatus}
                            initialListMode={reviewFocusListMode}
                            returnMatterId={reviewLaunchedFromMatter ? reviewFocusMatterId : null}
                            onReturnToMatter={() => {
                              setSoloReviewRail(false);
                              if (reviewFocusMatterId) {
                                setFocusMatterIdFromReview(reviewFocusMatterId);
                              }
                              setReviewLaunchedFromMatter(false);
                              openSoloMatterRail();
                            }}
                            onShowArtifact={(relPath) => openOutputInFolder(relPath)}
                            onRecordsChanged={() => {
                              setMatterRefreshVersion((v) => v + 1);
                              void refreshLists();
                            }}
                          />
                        </div>
                      ) : null}
                      {soloSurface === "matter" && config ? (
                        <div className="lm-solo-matter-rail" data-testid="lm-solo-matter-rail">
                          {matterWorkbenchNode}
                        </div>
                      ) : null}
                      {soloSurface === "chat" ? (
                        <>
                          <LawmindChatSessionTabs
                            sessions={chatSessionList.map((row) => ({
                              sessionId: row.sessionId,
                              title: row.title,
                            }))}
                            activeSessionId={activeChatSessionId}
                            loading={chatSessionsLoading}
                            busy={loading}
                            onSelect={(id) => void selectChatSession(id)}
                            onNewChat={() => void createNewChatSession()}
                            onRename={(id, title) => void renameChatSession(id, title)}
                            onDelete={(id) => void deleteChatSession(id)}
                          />
                          <LawmindChatMessagesColumn
                            selectedAssistantId={selectedAssistantId}
                            currentMessages={currentMessages}
                            copiedMessageIndex={copiedMessageIndex}
                            loading={loading}
                            messagesEndRef={messagesEndRef}
                            onCopyMessage={(text, index) => void copyMessage(text, index)}
                            onApplyPrompt={(prompt) => {
                              setInput(prompt);
                              textareaRef.current?.focus();
                            }}
                            onSendClarificationMessage={(text) => void sendChatMessage(text)}
                            fileChatPills={fileChatContextItems.map((it) => ({
                              id: it.id,
                              ...formatFileChatContextPill(it),
                            }))}
                            onRemoveFileChatPill={removeFileChatContextItem}
                            onClearFileChatPills={clearFileChatContext}
                          />
                        </>
                      ) : null}
                    </div>
                    {soloSurface === "chat" ? (
                      <LawmindChatComposeFooter
                        currentMessages={currentMessages}
                        input={input}
                        loading={loading}
                        error={error}
                        contextTaskId={contextTaskId}
                        contextMatterId={contextMatterId}
                        matterTitle={chatMatterHeadline}
                        textareaRef={textareaRef}
                        onInputChange={setInput}
                        onSend={() => void send()}
                        onAbortChat={abortChatSend}
                        onApplyPrompt={(prompt) => {
                          setInput(prompt);
                          textareaRef.current?.focus();
                        }}
                        onClearContext={clearContext}
                        onOpenComposeSettings={() => setShowSettings(true)}
                        composeModelConfigured={
                          health?.modelConfigured === true
                            ? true
                            : health?.modelConfigured === false
                              ? false
                              : undefined
                        }
                        showPlanPicker={shouldShowComposePlanPicker(edition.edition)}
                        sidecarNotice={
                          <>
                            {scaffoldDraft.draft ? (
                              <div className="lm-context-banner lm-scaffold-banner" data-testid="lm-chat-scaffold-banner">
                                <span>{scaffoldChatBannerText(scaffoldDraft.draft.title)}</span>
                                <button
                                  type="button"
                                  className="lm-btn"
                                  onClick={() => {
                                    const draft = scaffoldDraft.draft;
                                    if (!draft) {
                                      return;
                                    }
                                    openDeskReview({
                                      taskId: draft.taskId,
                                      matterId: draft.matterId,
                                      statusFilter: draft.reviewStatus ?? "pending",
                                      listMode: "all",
                                    });
                                  }}
                                >
                                  去改稿
                                </button>
                              </div>
                            ) : null}
                            {sidecarInbox.latest ? (
                            <div className="lm-context-banner" data-testid="lm-sidecar-inbox-banner">
                              <span>{sidecarInboxBannerText(sidecarInbox.latest)}</span>
                              <span className="lm-sidecar-inbox-actions">
                                <button
                                  type="button"
                                  className="lm-btn"
                                  onClick={() => {
                                    const item = sidecarInbox.latest;
                                    if (!item) {
                                      return;
                                    }
                                    setInput(item.prompt);
                                    addFileToChatContext({
                                      root: "workspace",
                                      relPath: item.relativePath,
                                      kind: "file",
                                    });
                                    void sidecarInbox.ack(item.relativePath);
                                    textareaRef.current?.focus();
                                  }}
                                >
                                  填入对话
                                </button>
                                <button
                                  type="button"
                                  className="lm-btn lm-btn-secondary"
                                  onClick={() => {
                                    const item = sidecarInbox.latest;
                                    if (!item) {
                                      return;
                                    }
                                    void sidecarInbox.ack(item.relativePath);
                                  }}
                                >
                                  忽略
                                </button>
                              </span>
                            </div>
                            ) : null}
                          </>
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </main>
      {showSidebarWorkbenchFiles &&
        config?.workspaceDir &&
        fileExplorerHost && (
          <FileWorkbench
            workspaceDir={config.workspaceDir}
            projectDir={projectDir}
            canUseFilesystemBridge
            onAddToChatContext={(payload) => {
              addFileToChatContext(payload);
              setMainView("workspace");
            }}
            portalHosts={{
              explorer: fileExplorerHost,
              editor: fileEditorHost ?? null,
              explorerLayout: "embedded",
            }}
            mattersPickList={fileWorkbenchMattersPickList}
            workspaceTreeRefreshKey={matterRefreshVersion}
            workspaceExplorerToolbar={
              <>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-small"
                  disabled={!config.apiBase}
                  title="打开案件工作台并筛选「未关联对话」案件"
                  onClick={() => {
                    recordsDeskMatters.setSelectedKey(RECORDS_DESK_UNLINKED);
                    if (soloDesk) {
                      openSoloMatterRail();
                    } else {
                      setMatterCockpitOpen(true);
                    }
                  }}
                >
                  未关联
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-small"
                  disabled={!config.apiBase}
                  title={
                    matterCockpitOpen && soloSurface !== "review"
                      ? soloDesk
                        ? "关闭案件列，回到对话"
                        : "关闭主区案件工作台，回到文件与对话"
                      : soloDesk
                        ? "在对话列打开案件，左侧文件留下"
                        : "在主区打开案件工作台（驾驶舱）"
                  }
                  onClick={() => {
                    if (soloDesk) {
                      if (soloSurface === "matter") {
                        setMatterCockpitOpen(false);
                      } else {
                        openSoloMatterRail();
                      }
                      return;
                    }
                    setMatterCockpitOpen((v) => !v);
                  }}
                >
                  {(soloDesk ? soloSurface === "matter" : matterCockpitOpen)
                    ? "隐藏工作台"
                    : "案件工作台"}
                </button>
              </>
            }
            casesNodeActions={workspaceCasesMenu}
          />
        )}
      {config?.apiBase ? (
        <>
          <LawmindCreateMatterDialog
            open={createMatterOpen}
            apiBase={config.apiBase}
            onClose={() => setCreateMatterOpen(false)}
            onSuccess={(mid) => {
              setMatterRefreshVersion((v) => v + 1);
              recordsDeskMatters.setSelectedKey(mid);
            }}
          />
          <LawmindMatterRenameDialog
            open={matterRenameOpen}
            apiBase={config.apiBase}
            onClose={() => setMatterRenameOpen(null)}
            onSuccess={() => setMatterRefreshVersion((v) => v + 1)}
          />
          <LawmindMatterDeleteDialog
            open={matterDeleteOpen}
            apiBase={config.apiBase}
            onClose={() => setMatterDeleteOpen(null)}
            onSuccess={(mid) => {
              if (contextMatterId === mid) {
                setContextMatterId(null);
              }
            }}
            onListChanged={() => setMatterRefreshVersion((v) => v + 1)}
          />
        </>
      ) : null}
    </div>
  );
}

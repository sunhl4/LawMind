import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLawmindAppShell } from "./lawmind-app-shell";
import type { AgentsDeskTab } from "./lawmind-agents-desk";
import { useActionSummaryQuery } from "./lawmind-query-hooks";
import { useLawmindRecordsDeskMatters, RECORDS_DESK_UNLINKED } from "./lawmind-records-desk-state";
import { useEdition } from "./use-edition";
import {
  LM_PANE_MAX_WIDTH_PX,
  LM_PANE_MIN_WIDTH_PX,
  readStoredBool,
  writeStoredBool,
} from "./lawmind-panel-layout";
import {
  countVisibleReviewPanes,
  readReviewPaneVisibility,
  writeReviewPaneVisibility,
  type ReviewPaneId,
} from "./lawmind-review-pane-prefs";
import { usePaneResizePx } from "./use-pane-resize";
import { apiGetJson } from "./api-client";
import { useLawyerReviewDesktopNotify } from "./lawmind-lawyer-review-notify";
import { applyAllUiPrefs } from "./lawmind-ui-prefs";

import { resolveWorkspacePath, artifactApiRelFromOutput } from "./lawmind-app-utils";
import { scheduleScrollChatMessagesToLatest } from "./lawmind-chat-scroll";
import { useLawmindAppRootHandlers } from "./app/useLawmindAppRootHandlers";
import { useLawmindAppRootLayout } from "./app/useLawmindAppRootLayout";
import { LawmindAppRootView } from "./app/LawmindAppRootView";


export function LawmindAppRoot() {
  const [_uiPrefsVersion, setUiPrefsVersion] = useState(0);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);

  useEffect(() => {
    applyAllUiPrefs();
  }, []);

  const {
    state,
    derived,
    actions,
  } = useLawmindAppShell();

  const {
    mainView,
    matterRefreshVersion,
    config,
    modelCatalog,
    selectedModelId,
    tasks,
    history,
    assistants,
    selectedAssistantId,
    setLoading,
    setError,
    contextTaskId,
    contextMatterId,
    collabSummarySettings,
    currentMessages,
    setMessagesByAssistant,
    sessionByAssistant,
    activeChatSessionId,
  } = state;

  const assistantDisplayById = useMemo(
    () => Object.fromEntries(assistants.map((a) => [a.assistantId, a.displayName])),
    [assistants],
  );

  const delegateAssistEnabled =
    assistants.filter((a) => a.assistantId !== selectedAssistantId).length > 0 &&
    collabSummarySettings?.collaborationEnabled !== false;

  const openDelegateAssist = useCallback(
    (taskHint?: string) => {
      const lastUser = [...currentMessages].toReversed().find((m) => m.role === "user");
      setDelegateTaskDefault(taskHint?.trim() || lastUser?.text?.trim().slice(0, 500) || "");
      setDelegateAssistOpen(true);
    },
    [currentMessages],
  );

  const { canUseFilesystemBridge } = derived;

  const recordsDeskMatters = useLawmindRecordsDeskMatters({
    enabled:
      (mainView === "workspace" || mainView === "agents") && Boolean(config),
    apiBase: config?.apiBase ?? "",
    matterRefreshVersion,
    tasks,
    history,
  });
  const [matterImportBusy, setMatterImportBusy] = useState(false);
  const [matterCockpitOpen, setMatterCockpitOpen] = useState(false);
  const [createMatterOpen, setCreateMatterOpen] = useState(false);
  const [matterDeleteOpen, setMatterDeleteOpen] = useState<{ matterId: string; label: string } | null>(null);
  const [delegateAssistOpen, setDelegateAssistOpen] = useState(false);
  const [delegateTaskDefault, setDelegateTaskDefault] = useState("");
  // Workspace-wide inbox for sidebar / header badges (not scoped to current matter).
  const actionSummaryQuery = useActionSummaryQuery(
    config?.apiBase ?? null,
    null,
    Boolean(config?.apiBase),
  );
  const actionSummaryTotal =
    actionSummaryQuery.data?.requiresDecisionTotal ?? actionSummaryQuery.data?.total ?? 0;
  const actionSummaryActiveJobs = actionSummaryQuery.data?.activeJobs ?? 0;
  const refreshActionSummary = useCallback(async () => {
    await actionSummaryQuery.refetch();
  }, [actionSummaryQuery.refetch]);

  const sessionRequiresActions = useMemo(() => {
    const last = [...currentMessages].toReversed().find((m) => m.role === "assistant");
    return last?.requiresAction ?? [];
  }, [currentMessages]);

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

  const [chatMatterHeadline, setChatMatterHeadline] = useState<string | null>(null);
  /** 左栏：资源树 portal；主区：仅编辑器 */
  const [fileExplorerHost, setFileExplorerHost] = useState<HTMLDivElement | null>(null);
  const [fileExplorerPortaled, setFileExplorerPortaled] = useState(false);
  const [fileEditorHost, setFileEditorHost] = useState<HTMLDivElement | null>(null);
  /** 从文书台点「返回案件」时一次性选中左侧案件，避免掉上下文 */
  const [focusMatterIdFromReview, setFocusMatterIdFromReview] = useState<string | null>(null);
  /** 从案件点「去复核」进入审核时为 true，点顶栏「审核」为 false，用于是否显示「返回案件」 */
  const [reviewLaunchedFromMatter, setReviewLaunchedFromMatter] = useState(false);
  /** 「在办」内分栏：进行中 / 交出去的活 / 按流程办 */
  const [agentsDeskTab, setAgentsDeskTab] = useState<AgentsDeskTab>("active");
  /** 「待我拍板」入口：在办列表仅显示 awaiting_* */
  const [agentsNeedsDecisionFocus, setAgentsNeedsDecisionFocus] = useState(false);

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
    setSelectedAssistantId,
    setContextTaskId,
    setContextMatterId,
    setShowSettings,
    sendChatMessage,
    setSessionByAssistant,
    createNewChatSession,
  } = actions;

  const {
    handleResumeRequiresAction,
    linkMatterToChat,
    workspaceCasesMenu,
    openReviewFromWorkspace,
    handleSpawnPreset,
    handleChatResumeComplete,
  } = useLawmindAppRootHandlers({
    config,
    selectedAssistantId,
    sessionByAssistant,
    activeChatSessionId,
    contextMatterId,
    contextTaskId,
    recordsDeskMatters,
    matterLabelById,
    matterImportBusy,
    setMatterImportBusy,
    setMatterRefreshVersion,
    setContextMatterId,
    setContextTaskId,
    setMainView,
    setMatterCockpitOpen,
    setCreateMatterOpen,
    setMatterDeleteOpen,
    setReviewLaunchedFromMatter,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setLoading,
    setError,
    setMessagesByAssistant,
    setSessionByAssistant,
    sendChatMessage,
    refreshActionSummary,
    createNewChatSession,
  });

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
  const _edition = useEdition(config?.apiBase ?? "");
  const workflowModelLabel =
    modelCatalog.find((m) => m.id === selectedModelId)?.label ?? selectedModelId;
  useEffect(() => {
    const unsub = window.lawmindDesktop?.onNotificationClick?.((payload) => {
      if (payload?.reason === "open_review") {
        setReviewLaunchedFromMatter(false);
        setMainView("review");
        setReviewFocusTaskId(payload.reviewTaskId?.trim() ? payload.reviewTaskId : null);
        setReviewFocusMatterId(payload.reviewMatterId?.trim() ? payload.reviewMatterId : null);
        setReviewFocusStatus("pending");
        setReviewFocusListMode("pending");
        return;
      }
      if (payload?.reason === "open_workspace_chat") {
        setMainView("workspace");
        const aid = payload.chatAssistantId?.trim();
        if (aid && assistants.some((a) => a.assistantId === aid)) {
          setSelectedAssistantId(aid);
        }
        scheduleScrollChatMessagesToLatest({ behavior: "smooth" });
        return;
      }
      if (payload?.reason !== "open_settings_collaboration") {
        return;
      }
      setShowSettings(false);
      setAgentsDeskTab("workflows");
      setMainView("agents");
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
    setMainView,
    setAgentsDeskTab,
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

  const [wsShowEditor, setWsShowEditor] = useState(() => readStoredBool("lawmind.ui.wsPaneEditor", true));
  const [wsShowChat, setWsShowChat] = useState(() => readStoredBool("lawmind.ui.wsPaneChat", true));

  useEffect(() => {
    writeStoredBool("lawmind.ui.wsPaneEditor", wsShowEditor);
  }, [wsShowEditor]);
  useEffect(() => {
    writeStoredBool("lawmind.ui.wsPaneChat", wsShowChat);
  }, [wsShowChat]);

  useEffect(() => {
    if (mainView !== "workspace" || matterCockpitOpen) {
      return;
    }
    const editorVisible = canUseFilesystemBridge && wsShowEditor;
    if (!wsShowChat && !editorVisible) {
      setWsShowChat(true);
    }
  }, [mainView, matterCockpitOpen, canUseFilesystemBridge, wsShowEditor, wsShowChat, setWsShowChat]);

  const [reviewPaneVisibility, setReviewPaneVisibility] = useState(readReviewPaneVisibility);

  useEffect(() => {
    writeReviewPaneVisibility(reviewPaneVisibility);
  }, [reviewPaneVisibility]);

  const toggleReviewPane = useCallback((id: ReviewPaneId) => {
    setReviewPaneVisibility((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (countVisibleReviewPanes(next) === 0) {
        return prev;
      }
      return next;
    });
  }, []);

  const { width: wsChatColWidth, onResizePointerDown: onWsChatSplitResize } = usePaneResizePx({
    storageKey: "lawmind.ui.wsChatColumnWidth",
    defaultWidth: 380,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
  });

  useEffect(() => {
    // Jumping in from 在办 / 待我拍板 / notifications must land on latest turn, not task start.
    return scheduleScrollChatMessagesToLatest({ behavior: "smooth" });
  }, [currentMessages, activeChatSessionId]);

  /** 文书台不展示全局左栏（材料树 / 工作目录 / 案件目录），主区留给签批工作台。 */
  const showAppSidebar = mainView !== "review";
  const showSidebarWorkbenchFiles =
    showAppSidebar && canUseFilesystemBridge && mainView === "workspace";
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

  const layout = useLawmindAppRootLayout({
    shell: { state, derived, actions },
    recordsDeskMatters,
    assistantDisplayById,
    delegateAssistEnabled,
    openDelegateAssist,
    handleResumeRequiresAction,
    linkMatterToChat,
    openReviewFromWorkspace,
    matterCockpitOpen,
    setMatterCockpitOpen,
    reviewLaunchedFromMatter,
    setReviewLaunchedFromMatter,
    agentsDeskTab,
    setAgentsDeskTab,
    agentsNeedsDecisionFocus,
    setAgentsNeedsDecisionFocus,
    setFocusMatterIdFromReview,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    onSidebarResizePointerDown,
    wsShowEditor,
    setWsShowEditor,
    wsShowChat,
    setWsShowChat,
    reviewPaneVisibility,
    toggleReviewPane,
    onWsChatSplitResize,
    wsChatColWidth,
    fileExplorerHost,
    setFileExplorerHost,
    fileExplorerPortaled,
    setFileExplorerPortaled,
    fileEditorHost,
    setFileEditorHost,
    textareaRef,
    messagesEndRef,
    showAppSidebar,
    showSidebarWorkbenchFiles,
    chatMatterHeadline,
    fileWorkbenchMattersPickList,
    workspaceCasesMenu,
    previewArtifact,
    openOutputInFolder,
    workflowModelLabel,
    actionSummaryTotal,
    actionSummaryActiveJobs,
    refreshActionSummary,
    sessionRequiresActions,
    onChatResumeComplete: handleChatResumeComplete,
    onSpawnPreset: (preset) => {
      void handleSpawnPreset(preset);
    },
    delegateAssistOpen,
    setDelegateAssistOpen,
    delegateTaskDefault,
    createMatterOpen,
    setCreateMatterOpen,
    matterDeleteOpen,
    setMatterDeleteOpen,
    taskDrawerOpen,
    setTaskDrawerOpen,
    setUiPrefsVersion,
  });

  return (
    <LawmindAppRootView mainView={mainView} {...layout} />
  );
}

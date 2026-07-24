import { useMemo, type RefObject } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { LawmindMainView } from "../lawmind-main-view";
import type {
  CollabEvent,
  DelegationRow,
  GateHistoryItem,
  HistoryItem,
  TaskRow,
} from "../lawmind-app-data";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { ReviewPaneVisibility, ReviewPaneId } from "../lawmind-review-pane-prefs";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type { AgentsDeskTab, NeedsDecisionDeskTarget } from "../lawmind-agents-desk";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "../lawmind-requires-action";
import type { ChatMsg } from "../lawmind-chat";
import type { FileChatContextItem } from "../lawmind-file-chat-context";
import type { TruthSourceContextPin } from "../../../../../src/lawmind/platform/compose-context-pin.ts";
import type { LawmindComposeExtras } from "../useLawmindComposeExtras";
import type { LawmindHealthState } from "../useLawmindAppBootstrapEffects";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import type { SetShowSettings } from "../lawmind-settings-shell";
import { scheduleScrollChatMessagesToLatest } from "../lawmind-chat-scroll";

export type UseLawmindMainBodyContentPropsInput = {
  config: AppConfig | null;
  matterRefreshVersion: number;
  selectedAssistantId: string;
  selectedMatterKey: string | null;
  tasks: TaskRow[];
  history: HistoryItem[];
  projectDir: string | null;
  assistantDisplayById: Record<string, string>;
  openDetail: (kind: "task" | "draft", id: string) => void;
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  historyBadgeClass: (kind: string, taskRecordKind?: string, status?: string) => string;
  setMatterRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
  recordsDeskMattersSetSelectedKey: (key: string) => void;
  linkMatterToChat: (matterId: string) => void;
  matterSidebarRows?: Array<{ key: string; title: string; matterId?: string | null }>;
  setAgentsDeskTab: (tab: AgentsDeskTab) => void;
  setAgentsNeedsDecisionFocus: (focus: boolean) => void;
  agentsNeedsDecisionFocus: boolean;
  agentsDeskFocusTarget: NeedsDecisionDeskTarget | null;
  setAgentsDeskFocusTarget: (t: NeedsDecisionDeskTarget | null) => void;
  setMainView: (view: LawmindMainView) => void;
  setContextMatterId: (id: string | null) => void;
  setMatterCockpitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSessionByAssistant: React.Dispatch<React.SetStateAction<Record<string, string | undefined>>>;
  setReviewLaunchedFromMatter: (v: boolean) => void;
  setReviewFocusTaskId: (id: string | null) => void;
  setReviewFocusMatterId: (id: string | null) => void;
  setReviewFocusStatus: (s: ArtifactDraft["reviewStatus"] | "all") => void;
  setReviewFocusListMode: (m: "pending" | "all") => void;
  reviewFocusTaskId: string | null;
  reviewFocusMatterId: string | null;
  reviewFocusStatus: ArtifactDraft["reviewStatus"] | "all";
  reviewFocusListMode: "pending" | "all";
  reviewRefreshVersion: number;
  reviewLaunchedFromMatter: boolean;
  reviewPaneVisibility: ReviewPaneVisibility;
  setFocusMatterIdFromReview: (id: string | null) => void;
  openOutputInFolder: (relPath?: string) => void;
  refreshLists: () => void | Promise<void>;
  setContextTaskId: (id: string | null) => void;
  setInput: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  watchBackgroundRevisionSession: (opts: {
    sessionId: string;
    assistantId: string;
    taskId: string;
  }) => void | Promise<void>;
  toggleReviewPane: (id: ReviewPaneId) => void;
  collabSummarySettings: CollabSummaryState | null | undefined;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  gateHistory: GateHistoryItem[];
  refreshCollaboration: () => void | Promise<void>;
  openDelegationTargetWorkspaceChat: (d: DelegationRow) => void | Promise<void>;
  agentsDeskTab: AgentsDeskTab;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  handleModelSelect: (id: string) => void;
  setShowSettings: SetShowSettings;
  openApiWizard: () => void;
  composeModelHint: string | null;
  composeModelQuickTestBusy: boolean;
  composeModelQuickTest: () => void | Promise<void>;
  health: LawmindHealthState;
  loading: boolean;
  workflowModelLabel: string;
  reconnectLocalService: () => void | Promise<void>;
  localServiceReconnecting: boolean;
  canUseFilesystemBridge: boolean;
  setFileEditorHost: (el: HTMLDivElement | null) => void;
  /** Portal host for meeting materials file tree */
  wsShowEditor: boolean;
  setWsShowEditor: React.Dispatch<React.SetStateAction<boolean>>;
  wsShowChat: boolean;
  setWsShowChat: React.Dispatch<React.SetStateAction<boolean>>;
  onWsChatSplitResize: (e: React.PointerEvent) => void;
  wsChatColWidth: number;
  chatSessionList: import("../useLawmindChatShell").ChatSessionListEntry[];
  chatSessionsLoading: boolean;
  selectChatSession: (sessionId: string, assistantIdOverride?: string) => void | Promise<void>;
  createNewChatSession: () => void | Promise<void>;
  renameChatSession: (sessionId: string, title: string) => void | Promise<void>;
  deleteChatSession: (sessionId: string) => void | Promise<void>;
  currentMessages: ChatMsg[];
  copiedMessageIndex: number | null;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  copyMessage: (text: string, index: number) => void | Promise<void>;
  sendChatMessage: (msg: string) => void | Promise<void>;
  streamCompactLabels: string[];
  fileChatContextItems: FileChatContextItem[];
  composeTruthPins: TruthSourceContextPin[];
  addFileToChatContext: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  addComposeTruthPin: (pin: TruthSourceContextPin) => void;
  removeFileChatContextItem: (id: string) => void;
  removeComposeTruthPin: (id: string) => void;
  clearFileChatContext: () => void;
  clearComposeTruthPins: () => void;
  contextTaskId: string | null;
  openReviewFromWorkspace: (target?: { taskId?: string; matterId?: string }) => void;
  openDelegateAssist: () => void;
  delegateAssistEnabled: boolean;
  revisionBackgroundActive: boolean;
  handleResumeRequiresAction: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
  ) => void | Promise<void>;
  input: string;
  error: string | null;
  contextMatterId: string | null;
  chatMatterHeadline: string | null;
  send: () => void | Promise<void>;
  abortChatSend: () => void;
  deleteChatMessageAt: (uiIndex: number) => void | Promise<void>;
  editChatMessageAt: (uiIndex: number, nextText: string) => void | Promise<void>;
  clearContext: () => void;
  allowWebSearch: boolean;
  setAllowWebSearch: (enabled: boolean) => void;
  queuedMessages: string[];
  cancelQueuedMessage: (index: number) => void;
  setTaskDrawerOpen: (open: boolean) => void;
  composeExtras: LawmindComposeExtras;
  setCreateMatterOpen: (open: boolean) => void;
  matterSidebarRowCount: number;
  activeChatSessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  refreshActionSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  /** Left rail hosts the session list (hide top tabs when true). */
  chatSessionsInSidebar?: boolean;
};

export function useLawmindMainBodyContentProps(
  input: UseLawmindMainBodyContentPropsInput,
): LawmindMainBodyContentProps {
  const {
    config,
    matterRefreshVersion,
    selectedAssistantId,
    selectedMatterKey,
    tasks,
    history,
    projectDir,
    assistantDisplayById,
    openDetail,
    formatRelativeTime,
    legalStatusLabel,
    taskBadgeClass,
    historyBadgeClass,
    setMatterRefreshVersion,
    recordsDeskMattersSetSelectedKey,
    linkMatterToChat,
    matterSidebarRows = [],
    setAgentsDeskTab,
    setAgentsNeedsDecisionFocus,
    agentsNeedsDecisionFocus,
    agentsDeskFocusTarget,
    setAgentsDeskFocusTarget,
    setMainView,
    setContextMatterId,
    setMatterCockpitOpen,
    setSessionByAssistant,
    setReviewLaunchedFromMatter,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    reviewFocusTaskId,
    reviewFocusMatterId,
    reviewFocusStatus,
    reviewFocusListMode,
    reviewRefreshVersion,
    reviewLaunchedFromMatter,
    reviewPaneVisibility,
    setFocusMatterIdFromReview,
    openOutputInFolder,
    refreshLists,
    setContextTaskId,
    setInput,
    textareaRef,
    watchBackgroundRevisionSession,
    toggleReviewPane,
    collabSummarySettings,
    delegations,
    collabEvents,
    gateHistory,
    refreshCollaboration,
    openDelegationTargetWorkspaceChat,
    agentsDeskTab,
    modelCatalog,
    selectedModelId,
    handleModelSelect,
    setShowSettings,
    openApiWizard,
    composeModelHint,
    composeModelQuickTestBusy,
    composeModelQuickTest,
    health,
    loading,
    workflowModelLabel,
    reconnectLocalService,
    localServiceReconnecting,
    canUseFilesystemBridge,
    setFileEditorHost,
    wsShowEditor,
    setWsShowEditor,
    wsShowChat,
    setWsShowChat,
    onWsChatSplitResize,
    wsChatColWidth,
    chatSessionList,
    chatSessionsLoading,
    selectChatSession,
    createNewChatSession,
    renameChatSession,
    deleteChatSession,
    currentMessages,
    copiedMessageIndex,
    messagesEndRef,
    copyMessage,
    sendChatMessage,
    streamCompactLabels,
    fileChatContextItems,
    composeTruthPins,
    addFileToChatContext,
    addComposeTruthPin,
    removeFileChatContextItem,
    removeComposeTruthPin,
    clearFileChatContext,
    clearComposeTruthPins,
    contextTaskId,
    openReviewFromWorkspace,
    openDelegateAssist,
    delegateAssistEnabled,
    revisionBackgroundActive,
    handleResumeRequiresAction,
    input: chatInput,
    error,
    contextMatterId,
    chatMatterHeadline,
    send,
    abortChatSend,
    deleteChatMessageAt,
    editChatMessageAt,
    clearContext,
    allowWebSearch,
    setAllowWebSearch,
    queuedMessages,
    cancelQueuedMessage,
    setTaskDrawerOpen,
    composeExtras,
    setCreateMatterOpen,
    matterSidebarRowCount,
    activeChatSessionId,
    sessionRequiresActions,
    refreshActionSummary,
    onChatResumeComplete,
    chatSessionsInSidebar = false,
  } = input;

  return useMemo(
    (): LawmindMainBodyContentProps => ({
      config,
      matterRefreshVersion,
      selectedAssistantId,
      selectedMatterKey,
      tasks,
      history,
      projectDir,
      assistantDisplayById,
      onOpenShellDetail: (kind, id) =>  openDetail(kind, id),
      formatRelativeTime,
      legalStatusLabel,
      taskBadgeClass,
      historyBadgeClass,
      onMatterCreated: (matterId) => {
        setMatterRefreshVersion((v) => v + 1);
        recordsDeskMattersSetSelectedKey(matterId);
      },
      onUseInChat: linkMatterToChat,
      onOpenWorkflowLibrary: () => {
        setAgentsDeskTab("workflows");
        setMainView("agents");
      },
      onOpenTopLevelMeeting: (matterId) => {
        const mid = matterId.trim();
        if (mid) {
          setContextMatterId(mid);
          recordsDeskMattersSetSelectedKey(mid);
        }
        setMatterCockpitOpen(false);
        setMainView("meeting");
      },
      meetingMatterOptions: matterSidebarRows
        .filter((r) => Boolean(r.matterId?.trim() || r.key.trim()))
        .map((r) => ({
          id: (r.matterId ?? r.key).trim(),
          title: r.title.trim() || (r.matterId ?? r.key).trim(),
        })),
      onSelectMeetingMatterScope: (matterId) => {
        const mid = matterId?.trim() || null;
        setContextMatterId(mid);
        if (mid) {
          recordsDeskMattersSetSelectedKey(mid);
        }
      },
      onOpenChatSession: (sessionId, matterId, assistantId) => {
        if (matterId?.trim()) {
          setContextMatterId(matterId.trim());
        }
        setMatterCockpitOpen(false);
        setMainView("workspace");
        void Promise.resolve(selectChatSession(sessionId, assistantId)).finally(() => {
          // Session load is async; land on latest execution, not the turn start.
          scheduleScrollChatMessagesToLatest({ behavior: "smooth" });
        });
      },
      onOpenReviewFromMatter: ({ taskId, matterId, statusFilter = "all", listMode = "all" }) => {
        setReviewLaunchedFromMatter(true);
        setReviewFocusTaskId(taskId);
        setReviewFocusMatterId(matterId ?? null);
        setReviewFocusStatus(statusFilter ?? "all");
        setReviewFocusListMode(listMode ?? "all");
        if (matterId) {
          setContextMatterId(matterId);
        }
        setMainView("review");
      },
      onOpenReviewFromWorkItem: (taskId, matterId) => {
        setReviewLaunchedFromMatter(false);
        setReviewFocusTaskId(taskId);
        setReviewFocusMatterId(matterId ?? null);
        setReviewFocusStatus("all");
        setReviewFocusListMode("pending");
        if (matterId) {
          setContextMatterId(matterId);
        }
        setMainView("review");
      },
      reviewFocusTaskId,
      reviewFocusMatterId,
      reviewFocusStatus,
      reviewFocusListMode,
      reviewRefreshVersion,
      reviewLaunchedFromMatter,
      reviewPaneVisibility,
      onReturnToMatter: () => {
        if (reviewFocusMatterId) {
          setFocusMatterIdFromReview(reviewFocusMatterId);
        }
        setReviewLaunchedFromMatter(false);
        setMainView("workspace");
        setMatterCockpitOpen(true);
      },
      onShowArtifact: (relPath) => openOutputInFolder(relPath),
      onRecordsChanged: () => {
        setMatterRefreshVersion((v) => v + 1);
        void refreshLists();
      },
      onGoToChat: ({ taskId, matterId, prompt }) => {
        setContextTaskId(taskId);
        if (matterId?.trim()) {
          setContextMatterId(matterId.trim());
        }
        setMainView("workspace");
        if (prompt?.trim()) {
          setInput(prompt.trim());
          textareaRef.current?.focus();
        }
      },
      onOpenAgentsDeskFromReview: () => {
        setMatterCockpitOpen(false);
        setAgentsDeskFocusTarget(null);
        setAgentsNeedsDecisionFocus(true);
        setAgentsDeskTab("active");
        setMainView("agents");
      },
      onRevisionJobQueued: ({ sessionId, assistantId, taskId }) => {
        void watchBackgroundRevisionSession({ sessionId, assistantId, taskId });
      },
      onToggleReviewPane: toggleReviewPane,
      collabSummarySettings,
      delegations,
      collabEvents,
      gateHistory,
      onRefreshCollaboration: refreshCollaboration,
      onOpenDelegationTargetChat: (d) => {
        void openDelegationTargetWorkspaceChat(d);
      },
      agentsDeskTab,
      onAgentsDeskTabChange: (tab) => {
        if (tab !== "active") {
          setAgentsNeedsDecisionFocus(false);
        }
        setAgentsDeskTab(tab);
      },
      needsDecisionFocus: agentsNeedsDecisionFocus,
      onClearNeedsDecisionFocus: () => {
        setAgentsNeedsDecisionFocus(false);
        setAgentsDeskFocusTarget(null);
      },
      agentsDeskFocusTarget,
      onAgentsDeskFocusTargetConsumed: () => setAgentsDeskFocusTarget(null),
      modelCatalog,
      selectedModelId,
      onModelSelect: handleModelSelect,
      onOpenComposeSettings: () => setShowSettings(true),
      onOpenMemoryInspector: () => setShowSettings(true, "memory"),
      onOpenApiWizard: openApiWizard,
      composeModelHint,
      composeModelQuickTestBusy,
      onComposeModelQuickTest: composeModelQuickTest,
      health,
      loading,
      workflowModelLabel,
      onReconnectLocalService: reconnectLocalService,
      localServiceReconnecting,
      canUseFilesystemBridge,
      setFileEditorHost,
      wsShowEditor,
      onShowEditorPane: () => setWsShowEditor(true),
      wsShowChat,
      onShowChatPane: () => setWsShowChat(true),
      onWsChatSplitResize,
      wsChatColWidth,
      chatSessionList,
      chatSessionsLoading,
      onSelectChatSession: selectChatSession,
      onCreateNewChatSession: () => {
        setMatterCockpitOpen(false);
        setMainView("workspace");
        return createNewChatSession();
      },
      onRenameChatSession: renameChatSession,
      onDeleteChatSession: deleteChatSession,
      currentMessages,
      copiedMessageIndex,
      messagesEndRef,
      onCopyMessage: copyMessage,
      onInputChange: setInput,
      textareaRef,
      onSendClarificationMessage: sendChatMessage,
      streamCompactLabels,
      fileChatContextItems,
      composeTruthPins,
      onAddFileToChatContext: addFileToChatContext,
      onAddComposeTruthPin: addComposeTruthPin,
      onRemoveFileChatPill: removeFileChatContextItem,
      onRemoveTruthPin: removeComposeTruthPin,
      onClearFileChatPills: clearFileChatContext,
      onClearTruthPills: clearComposeTruthPins,
      contextTaskId,
      onOpenReviewFromWorkspace: openReviewFromWorkspace,
      onDelegateAssist: openDelegateAssist,
      delegateAssistEnabled,
      revisionBackgroundActive,
      onResumeRequiresAction: handleResumeRequiresAction,
      input: chatInput,
      error,
      contextMatterId,
      chatMatterHeadline,
      onSend: send,
      onAbortChat: abortChatSend,
      onDeleteChatMessage: deleteChatMessageAt,
      onEditChatMessage: editChatMessageAt,
      onClearContext: clearContext,
      onContextMatterChange: setContextMatterId,
      allowWebSearch,
      onAllowWebSearchChange: setAllowWebSearch,
      queuedMessages,
      cancelQueuedMessage,
      onOpenTaskDrawer: () => setTaskDrawerOpen(true),
      onOpenNeedsDecisionDesk: (target?: NeedsDecisionDeskTarget) => {
        setMatterCockpitOpen(false);
        const hasTarget = Boolean(
          target?.sessionId?.trim() || target?.taskId?.trim() || target?.preferStatus,
        );
        setAgentsDeskFocusTarget(hasTarget && target ? target : null);
        setAgentsNeedsDecisionFocus(true);
        setAgentsDeskTab("active");
        setMainView("agents");
      },
      onOpenActionHub: (target?: NeedsDecisionDeskTarget) => {
        setMatterCockpitOpen(false);
        const hasTarget = Boolean(
          target?.sessionId?.trim() || target?.taskId?.trim() || target?.preferStatus,
        );
        setAgentsDeskFocusTarget(hasTarget && target ? target : null);
        setAgentsNeedsDecisionFocus(true);
        setAgentsDeskTab("active");
        setMainView("agents");
      },
      onOpenReviewFromAutomation: (taskId, matterId) => {
        setReviewLaunchedFromMatter(false);
        setReviewFocusTaskId(taskId);
        setReviewFocusMatterId(matterId ?? null);
        setReviewFocusStatus("all");
        setReviewFocusListMode("pending");
        if (matterId) {
          setContextMatterId(matterId);
        }
        setMainView("review");
      },
      onOpenAgentsWorkflows: (matterId) => {
        if (matterId?.trim()) {
          setContextMatterId(matterId.trim());
        }
        setAgentsDeskTab("workflows");
        setMainView("agents");
      },
      composeExtras,
      onCreateMatter: () => setCreateMatterOpen(true),
      showEmptyMatterGuide: matterSidebarRowCount === 0 && Boolean(config?.apiBase?.trim()),
      chatSessionsInSidebar,
      activeChatSessionId,
      sessionRequiresActions,
      onRefreshActionSummary: refreshActionSummary,
      onChatResumeComplete,
    }),
    [
      config,
      matterRefreshVersion,
      selectedAssistantId,
      selectedMatterKey,
      tasks,
      history,
      projectDir,
      assistantDisplayById,
      openDetail,
      formatRelativeTime,
      legalStatusLabel,
      taskBadgeClass,
      historyBadgeClass,
      setMatterRefreshVersion,
      recordsDeskMattersSetSelectedKey,
      linkMatterToChat,
      matterSidebarRows,
      setAgentsDeskTab,
      setAgentsNeedsDecisionFocus,
      agentsNeedsDecisionFocus,
      agentsDeskFocusTarget,
      setAgentsDeskFocusTarget,
      setMainView,
      setContextMatterId,
      setMatterCockpitOpen,
      setSessionByAssistant,
      setReviewLaunchedFromMatter,
      setReviewFocusTaskId,
      setReviewFocusMatterId,
      setReviewFocusStatus,
      setReviewFocusListMode,
      reviewFocusTaskId,
      reviewFocusMatterId,
      reviewFocusStatus,
      reviewFocusListMode,
      reviewRefreshVersion,
      reviewLaunchedFromMatter,
      reviewPaneVisibility,
      setFocusMatterIdFromReview,
      openOutputInFolder,
      refreshLists,
      setContextTaskId,
      setInput,
      textareaRef,
      watchBackgroundRevisionSession,
      toggleReviewPane,
      collabSummarySettings,
      delegations,
      collabEvents,
      gateHistory,
      refreshCollaboration,
      openDelegationTargetWorkspaceChat,
      agentsDeskTab,
      modelCatalog,
      selectedModelId,
      handleModelSelect,
      setShowSettings,
      openApiWizard,
      composeModelHint,
      composeModelQuickTestBusy,
      composeModelQuickTest,
      health,
      loading,
      workflowModelLabel,
      reconnectLocalService,
      localServiceReconnecting,
      canUseFilesystemBridge,
      setFileEditorHost,
      wsShowEditor,
      setWsShowEditor,
      wsShowChat,
      setWsShowChat,
      onWsChatSplitResize,
      wsChatColWidth,
      chatSessionList,
      chatSessionsLoading,
      selectChatSession,
      createNewChatSession,
      renameChatSession,
      deleteChatSession,
      currentMessages,
      copiedMessageIndex,
      messagesEndRef,
      copyMessage,
      sendChatMessage,
      streamCompactLabels,
      fileChatContextItems,
      composeTruthPins,
      addFileToChatContext,
      addComposeTruthPin,
      removeFileChatContextItem,
      removeComposeTruthPin,
      clearFileChatContext,
      clearComposeTruthPins,
      contextTaskId,
      openReviewFromWorkspace,
      openDelegateAssist,
      delegateAssistEnabled,
      revisionBackgroundActive,
      handleResumeRequiresAction,
      chatInput,
      error,
      contextMatterId,
      chatMatterHeadline,
      send,
      abortChatSend,
      deleteChatMessageAt,
      editChatMessageAt,
      clearContext,
      allowWebSearch,
      setAllowWebSearch,
      queuedMessages,
      cancelQueuedMessage,
      setTaskDrawerOpen,
      composeExtras,
      setCreateMatterOpen,
      matterSidebarRowCount,
      canUseFilesystemBridge,
      chatSessionsInSidebar,
      activeChatSessionId,
      sessionRequiresActions,
      refreshActionSummary,
      onChatResumeComplete,
      setReviewFocusListMode,
    ],
  );
}

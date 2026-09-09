import { useMemo, type RefObject } from "react";
import {
  buildChatDeepLinkHandlers,
  buildMeetingDeepLinkHandlers,
  buildReviewDeepLinkHandlers,
} from "./main-body-deep-links";
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
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type {
  AgentsDeskTab,
  AgentsWorkflowFocusTarget,
  NeedsDecisionDeskTarget,
} from "../lawmind-agents-desk";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "../lawmind-requires-action";
import type { ChatMsg } from "../lawmind-chat";
import type { FileChatContextItem } from "../lawmind-file-chat-context";
import type { TruthSourceContextPin } from "../../../../../src/lawmind/platform/compose-context-pin.ts";
import type { LawmindComposeExtras } from "../useLawmindComposeExtras";
import type { LawmindHealthState } from "../useLawmindAppBootstrapEffects";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import { useSettingsPanelStore } from "../stores/settings-panel-store";
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
  agentsWorkflowFocus: AgentsWorkflowFocusTarget | null;
  setAgentsWorkflowFocus: (t: AgentsWorkflowFocusTarget | null) => void;
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
    agentsWorkflowFocus,
    setAgentsWorkflowFocus,
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
    setFocusMatterIdFromReview,
    openOutputInFolder,
    refreshLists,
    setContextTaskId,
    setInput,
    textareaRef,
    watchBackgroundRevisionSession,
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

  return useMemo((): LawmindMainBodyContentProps => {
    const reviewLinks = buildReviewDeepLinkHandlers({
      setReviewLaunchedFromMatter,
      setReviewFocusTaskId,
      setReviewFocusMatterId,
      setReviewFocusStatus,
      setReviewFocusListMode,
      setContextMatterId,
      setMainView,
      setFocusMatterIdFromReview,
      setMatterCockpitOpen,
      reviewFocusMatterId,
    });
    const meetingLinks = buildMeetingDeepLinkHandlers({
      setContextMatterId,
      recordsDeskMattersSetSelectedKey,
      setMatterCockpitOpen,
      setMainView,
    });
    const chatLinks = buildChatDeepLinkHandlers({
      setContextMatterId,
      setMatterCockpitOpen,
      setMainView,
      setContextTaskId,
      selectChatSession,
      scheduleScrollChatMessagesToLatest,
      setInput,
      focusComposer: () => textareaRef.current?.focus(),
    });
    return {
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
      onOpenTopLevelMeeting: meetingLinks.onOpenTopLevelMeeting,
      meetingMatterOptions: matterSidebarRows
        .filter((r) => Boolean(r.matterId?.trim() || r.key.trim()))
        .map((r) => ({
          id: (r.matterId ?? r.key).trim(),
          title: r.title.trim() || (r.matterId ?? r.key).trim(),
        })),
      onSelectMeetingMatterScope: meetingLinks.onSelectMeetingMatterScope,
      onOpenChatSession: chatLinks.onOpenChatSession,
      onOpenReviewFromMatter: reviewLinks.onOpenReviewFromMatter,
      onOpenReviewFromWorkItem: reviewLinks.onOpenReviewFromWorkItem,
      reviewFocusTaskId,
      reviewFocusMatterId,
      reviewFocusStatus,
      reviewFocusListMode,
      reviewRefreshVersion,
      reviewLaunchedFromMatter,
      onReturnToMatter: reviewLinks.onReturnToMatter,
      onShowArtifact: (relPath) => openOutputInFolder(relPath),
      onRecordsChanged: () => {
        setMatterRefreshVersion((v) => v + 1);
        void refreshLists();
      },
      onGoToChat: chatLinks.onGoToChat,
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
      agentsWorkflowFocus,
      onAgentsWorkflowFocusConsumed: () => setAgentsWorkflowFocus(null),
      modelCatalog,
      selectedModelId,
      onModelSelect: handleModelSelect,
      onOpenComposeSettings: () => useSettingsPanelStore.getState().setSettingsPanel(true, "models"),
      onOpenSettings: () => useSettingsPanelStore.getState().setSettingsPanel(true),
      onOpenDoctor: () => useSettingsPanelStore.getState().setSettingsPanel(true, "doctor"),
      onOpenMemoryInspector: () => useSettingsPanelStore.getState().setSettingsPanel(true, "memory"),
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
          target?.sessionId?.trim() ||
            target?.taskId?.trim() ||
            target?.queueItemId?.trim() ||
            target?.jobId?.trim() ||
            target?.preferStatus,
        );
        if (hasTarget && target?.matterId?.trim()) {
          setContextMatterId(target.matterId.trim());
        }
        setAgentsDeskFocusTarget(hasTarget && target ? target : null);
        setAgentsNeedsDecisionFocus(true);
        setAgentsDeskTab("active");
        setMainView("agents");
      },
      onOpenActionHub: (target?: NeedsDecisionDeskTarget) => {
        setMatterCockpitOpen(false);
        const hasTarget = Boolean(
          target?.sessionId?.trim() ||
            target?.taskId?.trim() ||
            target?.queueItemId?.trim() ||
            target?.jobId?.trim() ||
            target?.preferStatus,
        );
        if (hasTarget && target?.matterId?.trim()) {
          setContextMatterId(target.matterId.trim());
        }
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
      onOpenAgentsWorkflows: (matterId, jobId) => {
        const mid = matterId?.trim();
        const jid = jobId?.trim();
        if (mid) {
          setContextMatterId(mid);
        }
        setAgentsWorkflowFocus(mid || jid ? { matterId: mid || undefined, jobId: jid || undefined } : null);
        setAgentsDeskTab("workflows");
        setMainView("agents");
      },
      composeExtras,
      onCreateMatter: () => setCreateMatterOpen(true),
      onSelectMatterKey: (matterId) => {
        const mid = matterId.trim();
        if (!mid) {
          return;
        }
        recordsDeskMattersSetSelectedKey(mid);
        setContextMatterId(mid);
      },
      showEmptyMatterGuide: matterSidebarRowCount === 0 && Boolean(config?.apiBase?.trim()),
      chatSessionsInSidebar,
      activeChatSessionId,
      sessionRequiresActions,
      onRefreshActionSummary: refreshActionSummary,
      onChatResumeComplete,
    };
    },
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
      agentsWorkflowFocus,
      setAgentsWorkflowFocus,
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
      setFocusMatterIdFromReview,
      openOutputInFolder,
      refreshLists,
      setContextTaskId,
      setInput,
      textareaRef,
      watchBackgroundRevisionSession,
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

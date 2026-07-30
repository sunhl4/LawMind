import type { RefObject } from "react";
import type { FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import type { AgentsDeskTab } from "../lawmind-agents-desk";
import type { useLawmindAppShell } from "../lawmind-app-shell";
import type { useLawmindRecordsDeskMatters } from "../lawmind-records-desk-state";
import type { ReviewPaneId, ReviewPaneVisibility } from "../lawmind-review-pane-prefs";
import type { LawMindRequiresAction } from "../lawmind-requires-action";
import {
  formatRelativeTime,
  historyBadgeClass,
  legalStatusLabel,
  taskBadgeClass,
} from "../lawmind-app-utils";
import type { LawmindAppRootViewProps } from "./LawmindAppRootView";
import { useLawmindAppHeaderProps } from "./useLawmindAppHeaderProps";
import { useLawmindMainBodyContentProps } from "./useLawmindMainBodyContentProps";
import { useLawmindAppOverlaysProps } from "./useLawmindAppOverlaysProps";
import { useLawmindAppSettingsPanelProps } from "./useLawmindAppSettingsPanelProps";
import { useLawmindAppSidebarProps } from "./useLawmindAppSidebarProps";
import {
  useLawmindAppRootDialogsProps,
  useLawmindFileWorkbenchHostProps,
} from "./useLawmindAppRootDialogsProps";
import { tryClarifyAttachSession } from "../lawmind-clarify-bring-in-bus";

type ShellBundle = ReturnType<typeof useLawmindAppShell>;
type RecordsDesk = ReturnType<typeof useLawmindRecordsDeskMatters>;

export type LawmindAppRootLayoutInput = {
  shell: ShellBundle;
  recordsDeskMatters: RecordsDesk;
  assistantDisplayById: Record<string, string>;
  delegateAssistEnabled: boolean;
  openDelegateAssist: () => void;
  handleResumeRequiresAction: (
    action: LawMindRequiresAction,
    decision: import("../lawmind-requires-action").LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
  ) => void | Promise<void>;
  linkMatterToChat: (matterId: string) => void;
  openReviewFromWorkspace: (target?: { taskId?: string; matterId?: string }) => void;
  matterCockpitOpen: boolean;
  setMatterCockpitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  reviewLaunchedFromMatter: boolean;
  setReviewLaunchedFromMatter: (v: boolean) => void;
  agentsDeskTab: AgentsDeskTab;
  setAgentsDeskTab: (tab: AgentsDeskTab) => void;
  agentsNeedsDecisionFocus: boolean;
  setAgentsNeedsDecisionFocus: (focus: boolean) => void;
  agentsDeskFocusTarget: import("../lawmind-agents-desk").NeedsDecisionDeskTarget | null;
  setAgentsDeskFocusTarget: (
    t: import("../lawmind-agents-desk").NeedsDecisionDeskTarget | null,
  ) => void;
  setFocusMatterIdFromReview: (id: string | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarWidth: number;
  onSidebarResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  wsShowEditor: boolean;
  setWsShowEditor: React.Dispatch<React.SetStateAction<boolean>>;
  wsShowChat: boolean;
  setWsShowChat: React.Dispatch<React.SetStateAction<boolean>>;
  reviewPaneVisibility: ReviewPaneVisibility;
  toggleReviewPane: (id: ReviewPaneId) => void;
  onWsChatSplitResize: (e: React.PointerEvent) => void;
  wsChatColWidth: number;
  fileExplorerHost: HTMLDivElement | null;
  setFileExplorerHost: (el: HTMLDivElement | null) => void;
  fileExplorerPortaled: boolean;
  setFileExplorerPortaled: React.Dispatch<React.SetStateAction<boolean>>;
  fileEditorHost: HTMLDivElement | null;
  setFileEditorHost: (el: HTMLDivElement | null) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  showAppSidebar: boolean;
  showSidebarWorkbenchFiles: boolean;
  chatMatterHeadline: string | null;
  fileWorkbenchMattersPickList: Array<{ id: string; label: string }>;
  workspaceCasesMenu: FileWorkbenchCasesNodeActions | null;
  previewArtifact: (outputPath?: string) => void;
  openOutputInFolder: (outputPath?: string) => void;
  workflowModelLabel: string;
  actionSummaryTotal: number;
  recentCollabCompleted?: number;
  actionSummaryActiveJobs: number;
  refreshActionSummary: () => void | Promise<void>;
  sessionRequiresActions: LawMindRequiresAction[];
  onChatResumeComplete?: () => void | Promise<void>;
  delegateAssistOpen: boolean;
  setDelegateAssistOpen: (open: boolean) => void;
  delegateTaskDefault: string;
  createMatterOpen: boolean;
  setCreateMatterOpen: (open: boolean) => void;
  matterDeleteOpen: { matterId: string; label: string } | null;
  setMatterDeleteOpen: (value: { matterId: string; label: string } | null) => void;
  taskDrawerOpen: boolean;
  setTaskDrawerOpen: (open: boolean) => void;
  setUiPrefsVersion: React.Dispatch<React.SetStateAction<number>>;
};

export function useLawmindAppRootLayout(
  input: LawmindAppRootLayoutInput,
): Omit<LawmindAppRootViewProps, "mainView"> {
  const { state, derived, actions } = input.shell;
  const { recordsDeskMatters } = input;

  const {
    mainView,
    reviewFocusTaskId,
    reviewFocusMatterId,
    reviewFocusStatus,
    reviewFocusListMode,
    matterRefreshVersion,
    config,
    health,
    modelCatalog,
    modelProviders,
    platformProviders,
    platformMode,
    selectedModelId,
    showWizard,
    wizApiKey,
    wizHasExistingKey,
    wizBaseUrl,
    wizModel,
    wizWorkspace,
    wizRetrievalMode,
    wizError,
    wizBusy,
    showAssistantEditor,
    editingAssistantId,
    assistantDraft,
    presets,
    assistants,
    asstBusy,
    asstError,
    showHelp,
    showSettings,
    settingsSectionId,
    settingsScrollAnchor,
    tasks,
    history,
    delegations,
    collabEvents,
    gateHistory,
    collabSummarySettings,
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
    selectedAssistantId,
    activeChatSessionId,
    chatSessionList,
    chatSessionsLoading,
    currentMessages,
    copiedMessageIndex,
    contextTaskId,
    contextMatterId,
    input: chatInput,
    error,
    loading,
    allowWebSearch,
    revisionBackgroundActive,
    reviewRefreshVersion,
    composeExtras,
    streamCompactLabels,
    fileChatContextItems,
    composeTruthPins,
    composeModelHint,
    composeModelQuickTestBusy,
    retrievalSaving,
    draftWithModelSaving,
    localServiceReconnecting,
  } = state;

  const {
    canUseFilesystemBridge,
    projectDir,
    selectedAssistant,
    selectedAssistantStats,
    workspaceLabel,
    retrievalLabel,
    currentMatterLabel,
  } = derived;

  const {
    setMainView,
    setShowWizard,
    setWizApiKey,
    setWizBaseUrl,
    setWizModel,
    setWizRetrievalMode,
    setShowAssistantEditor,
    setAssistantDraft,
    setInput,
    setContextTaskId,
    setContextMatterId,
    setShowSettings,
    setShowHelp,
    setMatterRefreshVersion,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setSelectedAssistantId,
    setAllowWebSearch,
    refreshLists,
    refreshCollaboration,
    openDetail,
    closeDetail,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    reconnectLocalService,
    runWizardSave,
    pickWs,
    pickProject,
    clearProject,
    send,
    abortChatSend,
    sendChatMessage,
    deleteChatMessageAt,
    editChatMessageAt,
    queuedMessages,
    cancelQueuedMessage,
    setSessionByAssistant,
    openNewAssistant,
    openEditAssistant,
    saveAssistant,
    removeAssistant,
    copyMessage,
    openApiWizard,
    composeModelQuickTest,
    handleModelSelect,
    refreshModelsCatalog,
    clearContext,
    addFileToChatContext,
    removeFileChatContextItem,
    clearFileChatContext,
    addComposeTruthPin,
    removeComposeTruthPin,
    clearComposeTruthPins,
    selectChatSession,
    openDelegationTargetWorkspaceChat,
    createNewChatSession,
    renameChatSession,
    deleteChatSession,
    watchBackgroundRevisionSession,
  } = actions;

  const headerProps = useLawmindAppHeaderProps({
    mainView,
    assistants,
    selectedAssistantId,
    setSelectedAssistantId,
    matterCockpitOpen: input.matterCockpitOpen,
    setMatterCockpitOpen: input.setMatterCockpitOpen,
    setMainView,
    apiBase: config?.apiBase,
    setAgentsNeedsDecisionFocus: input.setAgentsNeedsDecisionFocus,
    projectDir,
    currentMatterLabel: input.chatMatterHeadline?.trim() || currentMatterLabel,
    contextMatterId,
    sidebarCollapsed: input.sidebarCollapsed,
    setSidebarCollapsed: input.setSidebarCollapsed,
    wsShowEditor: input.wsShowEditor,
    setWsShowEditor: input.setWsShowEditor,
    wsShowChat: input.wsShowChat,
    setWsShowChat: input.setWsShowChat,
    canUseFilesystemBridge,
    reviewPaneVisibility: input.reviewPaneVisibility,
    toggleReviewPane: input.toggleReviewPane,
    setShowSettings,
    showSettings,
    health,
    workspaceDir: config?.workspaceDir,
    localServiceReconnecting,
    modelCatalog,
    selectedModelId,
    openApiWizard,
    composeModelQuickTest,
    composeModelQuickTestBusy,
  });

  const mainBodyProps = useLawmindMainBodyContentProps({
    config,
    matterRefreshVersion,
    selectedAssistantId,
    selectedMatterKey: recordsDeskMatters.selectedKey,
    tasks,
    history,
    projectDir,
    assistantDisplayById: input.assistantDisplayById,
    openDetail,
    formatRelativeTime,
    legalStatusLabel,
    taskBadgeClass,
    historyBadgeClass,
    setMatterRefreshVersion,
    recordsDeskMattersSetSelectedKey: recordsDeskMatters.setSelectedKey,
    linkMatterToChat: input.linkMatterToChat,
    matterSidebarRows: recordsDeskMatters.sidebarRows,
    setAgentsDeskTab: input.setAgentsDeskTab,
    setAgentsNeedsDecisionFocus: input.setAgentsNeedsDecisionFocus,
    agentsNeedsDecisionFocus: input.agentsNeedsDecisionFocus,
    agentsDeskFocusTarget: input.agentsDeskFocusTarget,
    setAgentsDeskFocusTarget: input.setAgentsDeskFocusTarget,
    setMainView,
    setContextMatterId,
    setMatterCockpitOpen: input.setMatterCockpitOpen,
    setSessionByAssistant,
    setReviewLaunchedFromMatter: input.setReviewLaunchedFromMatter,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    reviewFocusTaskId,
    reviewFocusMatterId,
    reviewFocusStatus,
    reviewFocusListMode,
    reviewRefreshVersion,
    reviewLaunchedFromMatter: input.reviewLaunchedFromMatter,
    reviewPaneVisibility: input.reviewPaneVisibility,
    setFocusMatterIdFromReview: input.setFocusMatterIdFromReview,
    openOutputInFolder: input.openOutputInFolder,
    refreshLists,
    setContextTaskId,
    setInput,
    textareaRef: input.textareaRef,
    watchBackgroundRevisionSession,
    toggleReviewPane: input.toggleReviewPane,
    collabSummarySettings,
    delegations,
    collabEvents,
    gateHistory,
    refreshCollaboration,
    openDelegationTargetWorkspaceChat,
    agentsDeskTab: input.agentsDeskTab,
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
    workflowModelLabel: input.workflowModelLabel,
    reconnectLocalService,
    localServiceReconnecting,
    canUseFilesystemBridge,
    setFileEditorHost: input.setFileEditorHost,
    wsShowEditor: input.wsShowEditor,
    setWsShowEditor: input.setWsShowEditor,
    wsShowChat: input.wsShowChat,
    setWsShowChat: input.setWsShowChat,
    onWsChatSplitResize: input.onWsChatSplitResize,
    wsChatColWidth: input.wsChatColWidth,
    chatSessionList,
    chatSessionsLoading,
    chatSessionsInSidebar: input.showAppSidebar && !input.sidebarCollapsed,
    selectChatSession,
    createNewChatSession,
    renameChatSession,
    deleteChatSession,
    currentMessages,
    copiedMessageIndex,
    messagesEndRef: input.messagesEndRef,
    copyMessage,
    sendChatMessage,
    streamCompactLabels,
    fileChatContextItems,
    composeTruthPins,
    addFileToChatContext,
    removeFileChatContextItem,
    clearFileChatContext,
    addComposeTruthPin,
    removeComposeTruthPin,
    clearComposeTruthPins,
    contextTaskId,
    openReviewFromWorkspace: input.openReviewFromWorkspace,
    openDelegateAssist: input.openDelegateAssist,
    delegateAssistEnabled: input.delegateAssistEnabled,
    revisionBackgroundActive,
    handleResumeRequiresAction: input.handleResumeRequiresAction,
    input: chatInput,
    error,
    contextMatterId,
    chatMatterHeadline: input.chatMatterHeadline,
    send,
    abortChatSend,
    deleteChatMessageAt,
    editChatMessageAt,
    clearContext,
    allowWebSearch,
    setAllowWebSearch,
    queuedMessages,
    cancelQueuedMessage,
    setTaskDrawerOpen: input.setTaskDrawerOpen,
    composeExtras,
    setCreateMatterOpen: input.setCreateMatterOpen,
    matterSidebarRowCount: recordsDeskMatters.sidebarRows.length,
    activeChatSessionId,
    sessionRequiresActions: input.sessionRequiresActions,
    refreshActionSummary: input.refreshActionSummary,
    onChatResumeComplete: input.onChatResumeComplete,
  });

  const overlayProps = useLawmindAppOverlaysProps({
    showWizard,
    wizApiKey,
    setWizApiKey,
    wizHasExistingKey,
    wizBaseUrl,
    setWizBaseUrl,
    wizModel,
    setWizModel,
    wizWorkspace,
    wizRetrievalMode,
    setWizRetrievalMode,
    wizError,
    wizBusy,
    pickWs,
    setShowWizard,
    runWizardSave,
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
    canUseFilesystemBridge,
    apiBase: config?.apiBase,
    closeDetail,
    previewArtifact: input.previewArtifact,
    openOutputInFolder: input.openOutputInFolder,
    setContextTaskId,
    setContextMatterId,
    showAssistantEditor,
    editingAssistantId,
    assistantDraft,
    presets,
    assistants,
    asstBusy,
    asstError,
    setAssistantDraft,
    setShowAssistantEditor,
    saveAssistant,
    showHelp,
    setShowHelp,
    config,
    setAgentsDeskTab: input.setAgentsDeskTab,
    setMainView,
    setShowSettings,
    setInput,
    composeTextareaRef: input.textareaRef,
    suppressFirstRunAutoOpen: showWizard || health?.modelConfigured === false,
  });

  const settingsPanelProps = useLawmindAppSettingsPanelProps({
    showSettings,
    settingsSectionId,
    settingsScrollAnchor,
    setShowSettings,
    config,
    projectDir,
    workspaceLabel,
    health,
    collabSummarySettings,
    selectedAssistantId,
    setSelectedAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving,
    openNewAssistant,
    openEditAssistant,
    removeAssistant,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    reconnectLocalService,
    localServiceReconnecting,
    openApiWizard,
    modelProviders,
    platformProviders,
    platformMode,
    selectedModelId,
    modelCatalog,
    refreshModelsCatalog,
    pickProject,
    clearProject,
    setAgentsDeskTab: input.setAgentsDeskTab,
    setAgentsNeedsDecisionFocus: input.setAgentsNeedsDecisionFocus,
    setMainView,
    assistants,
    onPrefsChange: () => input.setUiPrefsVersion((v) => v + 1),
    matterSidebarRows: recordsDeskMatters.sidebarRows,
    contextMatterId,
    onOpenReviewFromAutomation: (taskId, matterId) => {
      input.setReviewLaunchedFromMatter(false);
      setReviewFocusTaskId(taskId);
      setReviewFocusMatterId(matterId ?? null);
      setReviewFocusStatus("all");
      setReviewFocusListMode("pending");
      if (matterId) {
        setContextMatterId(matterId);
      }
      setMainView("review");
    },
  });

  const sidebarProps = useLawmindAppSidebarProps({
    // Settings is a full-page surface — hide the workspace left rail while open.
    showAppSidebar: input.showAppSidebar && !showSettings,
    sidebarCollapsed: input.sidebarCollapsed,
    sidebarWidth: input.sidebarWidth,
    showSidebarWorkbenchFiles: input.showSidebarWorkbenchFiles,
    showExplorerSkeleton: input.showSidebarWorkbenchFiles && !input.fileExplorerPortaled,
    onSidebarResizePointerDown: input.onSidebarResizePointerDown,
    setShowSettings,
    showSettings,
    setFileExplorerHost: input.setFileExplorerHost,
    actionSummaryTotal: input.actionSummaryTotal,
    recentCollabCompleted: input.recentCollabCompleted ?? 0,
    matterSidebarRows: recordsDeskMatters.sidebarRows,
    selectedMatterKey: recordsDeskMatters.selectedKey,
    onSelectMatterKey: recordsDeskMatters.setSelectedKey,
    onSelectMatterForCockpit: (matterId) => {
      recordsDeskMatters.setSelectedKey(matterId);
      setContextMatterId(matterId);
      input.setMatterCockpitOpen(true);
      setMainView("workspace");
    },
    onSelectMatterScope: (matterId) => {
      recordsDeskMatters.setSelectedKey(matterId);
      setContextMatterId(matterId);
    },
    matterCockpitOpen: input.matterCockpitOpen,
    mainView,
    apiBase: config?.apiBase,
    setMainView,
    setMatterCockpitOpen: input.setMatterCockpitOpen,
    setAgentsDeskTab: input.setAgentsDeskTab,
    setAgentsNeedsDecisionFocus: input.setAgentsNeedsDecisionFocus,
    chatSessions: chatSessionList,
    activeChatSessionId,
    chatSessionsLoading,
    chatBusy: loading,
    onSelectChatSession: (sessionId: string) => {
      const row = chatSessionList.find((s) => s.sessionId === sessionId);
      if (
        tryClarifyAttachSession({
          sessionId,
          title: (row?.title ?? "").trim() || sessionId.slice(0, 8),
        })
      ) {
        return;
      }
      return selectChatSession(sessionId);
    },
    onCreateNewChatSession: () => {
      input.setMatterCockpitOpen(false);
      setMainView("workspace");
      return createNewChatSession();
    },
    onRenameChatSession: renameChatSession,
    onDeleteChatSession: deleteChatSession,
    onCreateMatter: () => input.setCreateMatterOpen(true),
  });

  const dialogProps = useLawmindAppRootDialogsProps({
    apiBase: config?.apiBase,
    delegateAssistOpen: input.delegateAssistOpen,
    setDelegateAssistOpen: input.setDelegateAssistOpen,
    selectedAssistantId,
    activeChatSessionId,
    contextMatterId,
    delegateTaskDefault: input.delegateTaskDefault,
    assistants,
    delegations,
    modelCatalog,
    selectedModelId,
    refreshCollaboration,
    createMatterOpen: input.createMatterOpen,
    setCreateMatterOpen: input.setCreateMatterOpen,
    setMatterRefreshVersion,
    recordsDeskMattersSetSelectedKey: recordsDeskMatters.setSelectedKey,
    matterDeleteOpen: input.matterDeleteOpen,
    setMatterDeleteOpen: input.setMatterDeleteOpen,
    setContextMatterId,
    taskDrawerOpen: input.taskDrawerOpen,
    setTaskDrawerOpen: input.setTaskDrawerOpen,
    onOpenApprovalsFromDrawer: () => {
      input.setAgentsNeedsDecisionFocus(true);
      input.setAgentsDeskTab("active");
      setMainView("agents");
    },
  });

  const fileWorkbenchHostProps = useLawmindFileWorkbenchHostProps({
    workspaceDir: config?.workspaceDir,
    apiBase: config?.apiBase,
    showSidebarWorkbenchFiles: input.showSidebarWorkbenchFiles,
    projectDir,
    onPickProject: () => void pickProject(),
    fileExplorerHost: input.fileExplorerHost,
    fileEditorHost: input.fileEditorHost,
    setFileExplorerPortaled: input.setFileExplorerPortaled,
    addFileToChatContext,
    setMainView,
    mainView,
    fileWorkbenchMattersPickList: input.fileWorkbenchMattersPickList,
    matterRefreshVersion,
    workspaceCasesMenu: input.workspaceCasesMenu,
  });

  return {
    overlayProps,
    settingsPanelProps,
    sidebarProps,
    headerProps,
    mainBodyProps,
    fileWorkbenchHostProps,
    dialogProps,
  };
}

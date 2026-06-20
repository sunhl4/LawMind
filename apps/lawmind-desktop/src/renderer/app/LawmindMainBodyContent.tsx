import type { RefObject } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { AppConfig } from "../lawmind-app-bootstrap";
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
import type { CollaborationDeskTab } from "../LawmindCollaborationDesk";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "../lawmind-requires-action";
import type { ChatMsg } from "../lawmind-chat";
import type { FileChatContextItem } from "../lawmind-file-chat-context";
import type { LawmindComposeExtras } from "../useLawmindComposeExtras";
import type { LawmindHealthState } from "../useLawmindAppBootstrapEffects";
import { CollaborationView } from "./CollaborationView";
import { MatterView } from "./MatterView";
import { ReviewView } from "./ReviewView";
import { LawmindWorkspaceMainPane } from "./LawmindWorkspaceMainPane";
import { LawmindWorkspaceBootstrapGate } from "./LawmindWorkspaceBootstrapGate";
import { useLawmindShellNavigationContext } from "./LawmindShellContexts";

export type LawmindMainBodyContentProps = {
  config: AppConfig | null;
  matterRefreshVersion: number;
  selectedAssistantId: string;
  selectedMatterKey: string | null;
  tasks: TaskRow[];
  history: HistoryItem[];
  projectDir: string | null;
  assistantDisplayById: Record<string, string>;
  onOpenShellDetail: (kind: "task" | "draft", id: string) => void;
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  historyBadgeClass: (kind: string, taskRecordKind?: string, status?: string) => string;
  onMatterCreated: (matterId: string) => void;
  onUseInChat: (matterId: string) => void;
  onOpenWorkflowLibrary: () => void;
  onOpenChatSession: (sessionId: string, matterId?: string) => void;
  onOpenReviewFromMatter: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  reviewFocusTaskId: string | null;
  reviewFocusMatterId: string | null;
  reviewFocusStatus: ArtifactDraft["reviewStatus"] | "all";
  reviewFocusListMode: "pending" | "all";
  reviewRefreshVersion: number;
  reviewLaunchedFromMatter: boolean;
  reviewPaneVisibility: ReviewPaneVisibility;
  onReturnToMatter: () => void;
  onShowArtifact: (relPath: string) => void;
  onRecordsChanged: () => void;
  onGoToChat: (opts: { taskId: string; matterId?: string; prompt?: string }) => void;
  onRevisionJobQueued: (opts: { sessionId: string; assistantId: string; taskId: string }) => void;
  onToggleReviewPane: (id: ReviewPaneId) => void;
  collabSummarySettings: CollabSummaryState | null | undefined;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  gateHistory: GateHistoryItem[];
  onRefreshCollaboration: () => void | Promise<void>;
  onOpenDelegationTargetChat: (d: DelegationRow) => void | Promise<void>;
  collaborationDeskTab: CollaborationDeskTab;
  onDeskTabChange: (tab: CollaborationDeskTab) => void;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onModelSelect: (id: string) => void;
  onOpenComposeSettings: () => void;
  onOpenApiWizard: () => void;
  composeModelHint: string | null;
  composeModelQuickTestBusy: boolean;
  onComposeModelQuickTest: () => void | Promise<void>;
  health: LawmindHealthState;
  loading: boolean;
  workflowModelLabel: string;
  onReconnectLocalService: () => void | Promise<void>;
  localServiceReconnecting: boolean;
  canUseFilesystemBridge: boolean;
  setFileEditorHost: (el: HTMLDivElement | null) => void;
  wsShowEditor: boolean;
  onShowEditorPane: () => void;
  wsShowChat: boolean;
  onShowChatPane: () => void;
  onWsChatSplitResize: (e: React.PointerEvent) => void;
  wsChatColWidth: number;
  chatSessionList: import("../useLawmindChatShell").ChatSessionListEntry[];
  chatSessionsLoading: boolean;
  onSelectChatSession: (sessionId: string) => void | Promise<void>;
  onCreateNewChatSession: () => void | Promise<void>;
  onRenameChatSession: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteChatSession: (sessionId: string) => void | Promise<void>;
  currentMessages: ChatMsg[];
  copiedMessageIndex: number | null;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onInputChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSendClarificationMessage: (msg: string) => void | Promise<void>;
  streamCompactLabels: string[];
  fileChatContextItems: FileChatContextItem[];
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
  contextTaskId: string | null;
  onOpenReviewFromWorkspace: () => void;
  onDelegateAssist: () => void;
  delegateAssistEnabled: boolean;
  revisionBackgroundActive: boolean;
  onResumeRequiresAction: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
    opts?: { skipApprovalDialog?: boolean },
  ) => void | Promise<void>;
  input: string;
  error: string | null;
  contextMatterId: string | null;
  chatMatterHeadline: string | null;
  onSend: () => void | Promise<void>;
  onAbortChat: () => void;
  onClearContext: () => void;
  allowWebSearch: boolean;
  onAllowWebSearchChange: (enabled: boolean) => void;
  queuedMessages: string[];
  cancelQueuedMessage: (index: number) => void;
  onOpenTaskDrawer: () => void;
  onOpenActionHub: () => void;
  composeExtras: LawmindComposeExtras;
  onCreateMatter?: () => void;
  showEmptyMatterGuide?: boolean;
};

export function LawmindMainBodyContent(props: LawmindMainBodyContentProps) {
  const { mainView, matterCockpitOpen } = useLawmindShellNavigationContext();
  const {
    config,
    matterRefreshVersion,
    selectedAssistantId,
    selectedMatterKey,
    tasks,
    history,
    projectDir,
    assistantDisplayById,
    onOpenShellDetail,
    formatRelativeTime,
    legalStatusLabel,
    taskBadgeClass,
    historyBadgeClass,
    onMatterCreated,
    onUseInChat,
    onOpenWorkflowLibrary,
    onOpenChatSession,
    onOpenReviewFromMatter,
    reviewFocusTaskId,
    reviewFocusMatterId,
    reviewFocusStatus,
    reviewFocusListMode,
    reviewRefreshVersion,
    reviewLaunchedFromMatter,
    reviewPaneVisibility,
    onReturnToMatter,
    onShowArtifact,
    onRecordsChanged,
    onGoToChat,
    onRevisionJobQueued,
    onToggleReviewPane,
    collabSummarySettings,
    delegations,
    collabEvents,
    gateHistory,
    onRefreshCollaboration,
    onOpenDelegationTargetChat,
    collaborationDeskTab,
    onDeskTabChange,
    modelCatalog,
    selectedModelId,
    onModelSelect,
    onOpenComposeSettings,
    onOpenApiWizard,
    composeModelHint,
    composeModelQuickTestBusy,
    onComposeModelQuickTest,
    health,
    loading,
    workflowModelLabel,
    onReconnectLocalService,
    localServiceReconnecting,
    canUseFilesystemBridge,
    setFileEditorHost,
    wsShowEditor,
    onShowEditorPane,
    wsShowChat,
    onShowChatPane,
    onWsChatSplitResize,
    wsChatColWidth,
    chatSessionList,
    chatSessionsLoading,
    onSelectChatSession,
    onCreateNewChatSession,
    onRenameChatSession,
    onDeleteChatSession,
    currentMessages,
    copiedMessageIndex,
    messagesEndRef,
    onCopyMessage,
    onInputChange,
    textareaRef,
    onSendClarificationMessage,
    streamCompactLabels,
    fileChatContextItems,
    onRemoveFileChatPill,
    onClearFileChatPills,
    contextTaskId,
    onOpenReviewFromWorkspace,
    onDelegateAssist,
    delegateAssistEnabled,
    revisionBackgroundActive,
    onResumeRequiresAction,
    input,
    error,
    contextMatterId,
    chatMatterHeadline,
    onSend,
    onAbortChat,
    onClearContext,
    allowWebSearch,
    onAllowWebSearchChange,
    queuedMessages,
    cancelQueuedMessage,
    onOpenTaskDrawer,
    onOpenActionHub,
    composeExtras,
    onCreateMatter,
    showEmptyMatterGuide,
  } = props;

  if (mainView === "workspace" && matterCockpitOpen && config) {
    return (
      <MatterView
        apiBase={config.apiBase}
        refreshVersion={matterRefreshVersion}
        assistantId={selectedAssistantId}
        selectedMatterKey={selectedMatterKey}
        tasks={tasks}
        history={history}
        workspaceDir={config.workspaceDir ?? null}
        projectDir={projectDir}
        assistantDisplayById={assistantDisplayById}
        onOpenShellDetail={onOpenShellDetail}
        formatShellRelativeTime={formatRelativeTime}
        legalStatusLabel={legalStatusLabel}
        taskBadgeClass={taskBadgeClass}
        historyBadgeClass={historyBadgeClass}
        onMatterCreated={onMatterCreated}
        onUseInChat={onUseInChat}
        onOpenWorkflowLibrary={onOpenWorkflowLibrary}
        onOpenChatSession={onOpenChatSession}
        onOpenReview={onOpenReviewFromMatter}
      />
    );
  }
  if (mainView === "review" && config) {
    return (
      <ReviewView
        apiBase={config.apiBase}
        assistantId={selectedAssistantId}
        initialTaskId={reviewFocusTaskId}
        initialMatterId={reviewFocusMatterId}
        initialStatusFilter={reviewFocusStatus}
        initialListMode={reviewFocusListMode}
        externalRefreshToken={reviewRefreshVersion}
        returnMatterId={reviewLaunchedFromMatter ? reviewFocusMatterId : null}
        paneVisibility={reviewPaneVisibility}
        onReturnToMatter={onReturnToMatter}
        onShowArtifact={onShowArtifact}
        onRecordsChanged={onRecordsChanged}
        onGoToChat={onGoToChat}
        onRevisionJobQueued={onRevisionJobQueued}
        onToggleReviewPane={onToggleReviewPane}
      />
    );
  }
  if (mainView === "collaboration") {
    return (
      <CollaborationView
        config={config}
        collabSummarySettings={collabSummarySettings}
        selectedAssistantId={selectedAssistantId}
        delegations={delegations}
        collabEvents={collabEvents}
        gateHistory={gateHistory}
        formatRelativeTime={formatRelativeTime}
        onRefreshCollaboration={onRefreshCollaboration}
        onOpenDelegationTargetChat={onOpenDelegationTargetChat}
        collaborationDeskTab={collaborationDeskTab}
        onDeskTabChange={onDeskTabChange}
        modelCatalog={modelCatalog}
        selectedModelId={selectedModelId}
        onModelSelect={onModelSelect}
        onOpenComposeSettings={onOpenComposeSettings}
        onOpenApiWizard={onOpenApiWizard}
        composeModelHint={composeModelHint}
        composeModelQuickTestBusy={composeModelQuickTestBusy}
        onComposeModelQuickTest={onComposeModelQuickTest}
        healthModelConfigured={
          health?.modelConfigured === true ? true : health?.modelConfigured === false ? false : undefined
        }
        chatLoading={loading}
        workflowModelLabel={workflowModelLabel}
        assistantDisplayById={assistantDisplayById}
        onReconnectLocalService={onReconnectLocalService}
        localServiceReconnecting={localServiceReconnecting}
      />
    );
  }
  if (mainView === "workspace" && !matterCockpitOpen && !config) {
    return (
      <LawmindWorkspaceBootstrapGate error={error} onOpenApiWizard={onOpenApiWizard} />
    );
  }
  return (
    <LawmindWorkspaceMainPane
      canUseFilesystemBridge={canUseFilesystemBridge}
      setFileEditorHost={setFileEditorHost}
      wsShowEditor={wsShowEditor}
      onShowEditorPane={onShowEditorPane}
      wsShowChat={wsShowChat}
      onShowChatPane={onShowChatPane}
      onWsChatSplitResize={onWsChatSplitResize}
      wsChatColWidth={wsChatColWidth}
      chatSessionList={chatSessionList}
      chatSessionsLoading={chatSessionsLoading}
      loading={loading}
      onSelectChatSession={onSelectChatSession}
      onCreateNewChatSession={onCreateNewChatSession}
      onRenameChatSession={onRenameChatSession}
      onDeleteChatSession={onDeleteChatSession}
      config={config}
      currentMessages={currentMessages}
      copiedMessageIndex={copiedMessageIndex}
      messagesEndRef={messagesEndRef}
      onCopyMessage={onCopyMessage}
      onInputChange={onInputChange}
      textareaRef={textareaRef}
      onSendClarificationMessage={onSendClarificationMessage}
      streamCompactLabels={streamCompactLabels}
      fileChatContextItems={fileChatContextItems}
      onRemoveFileChatPill={onRemoveFileChatPill}
      onClearFileChatPills={onClearFileChatPills}
      contextTaskId={contextTaskId}
      onOpenReview={onOpenReviewFromWorkspace}
      onDelegateAssist={onDelegateAssist}
      delegateAssistEnabled={delegateAssistEnabled}
      revisionBackgroundActive={revisionBackgroundActive}
      onResumeRequiresAction={onResumeRequiresAction}
      input={input}
      error={error}
      contextMatterId={contextMatterId}
      chatMatterHeadline={chatMatterHeadline}
      onSend={onSend}
      onAbortChat={onAbortChat}
      onClearContext={onClearContext}
      onOpenComposeSettings={onOpenComposeSettings}
      onOpenApiWizard={onOpenApiWizard}
      composeModelHint={composeModelHint}
      composeModelQuickTestBusy={composeModelQuickTestBusy}
      onComposeModelQuickTest={onComposeModelQuickTest}
      composeModelConfigured={
        health?.modelConfigured === true ? true : health?.modelConfigured === false ? false : undefined
      }
      modelCatalog={modelCatalog}
      selectedModelId={selectedModelId}
      onModelSelect={onModelSelect}
      allowWebSearch={allowWebSearch}
      webSearchPolicyBlocked={health?.webSearchPolicyBlocked}
      onAllowWebSearchChange={onAllowWebSearchChange}
      queuedMessages={queuedMessages}
      cancelQueuedMessage={cancelQueuedMessage}
      onOpenTaskDrawer={onOpenTaskDrawer}
      onOpenActionHub={onOpenActionHub}
      composeExtras={composeExtras}
      onCreateMatter={onCreateMatter}
      onOpenWorkflowLibrary={onOpenWorkflowLibrary}
      showEmptyMatterGuide={showEmptyMatterGuide}
    />
  );
}

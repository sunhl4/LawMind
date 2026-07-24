/**
 * Narrow LawmindMainBodyContentProps → LawmindWorkspaceMainPaneProps.
 * Keeps the default workspace branch under ~40 props without duplicating the fan-out list.
 */

import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import type { LawmindWorkspaceMainPaneProps } from "./LawmindWorkspaceMainPane";

export function pickWorkspaceMainPaneProps(
  props: LawmindMainBodyContentProps,
): LawmindWorkspaceMainPaneProps {
  return {
    canUseFilesystemBridge: props.canUseFilesystemBridge,
    setFileEditorHost: props.setFileEditorHost,
    wsShowEditor: props.wsShowEditor,
    onShowEditorPane: props.onShowEditorPane,
    wsShowChat: props.wsShowChat,
    onShowChatPane: props.onShowChatPane,
    onWsChatSplitResize: props.onWsChatSplitResize,
    wsChatColWidth: props.wsChatColWidth,
    chatSessionList: props.chatSessionList,
    chatSessionsLoading: props.chatSessionsLoading,
    loading: props.loading,
    onSelectChatSession: props.onSelectChatSession,
    onCreateNewChatSession: props.onCreateNewChatSession,
    onRenameChatSession: props.onRenameChatSession,
    onDeleteChatSession: props.onDeleteChatSession,
    config: props.config,
    currentMessages: props.currentMessages,
    copiedMessageIndex: props.copiedMessageIndex,
    messagesEndRef: props.messagesEndRef,
    onCopyMessage: props.onCopyMessage,
    onInputChange: props.onInputChange,
    textareaRef: props.textareaRef,
    onSendClarificationMessage: props.onSendClarificationMessage,
    streamCompactLabels: props.streamCompactLabels,
    fileChatContextItems: props.fileChatContextItems,
    composeTruthPins: props.composeTruthPins,
    onAddComposeTruthPin: props.onAddComposeTruthPin,
    onRemoveTruthPin: props.onRemoveTruthPin,
    onClearTruthPills: props.onClearTruthPills,
    onAddFileToChatContext: props.onAddFileToChatContext,
    onRemoveFileChatPill: props.onRemoveFileChatPill,
    onClearFileChatPills: props.onClearFileChatPills,
    contextTaskId: props.contextTaskId,
    onOpenReview: props.onOpenReviewFromWorkspace,
    onDelegateAssist: props.onDelegateAssist,
    delegateAssistEnabled: props.delegateAssistEnabled,
    revisionBackgroundActive: props.revisionBackgroundActive,
    onResumeRequiresAction: props.onResumeRequiresAction,
    input: props.input,
    error: props.error,
    contextMatterId: props.contextMatterId,
    chatMatterHeadline: props.chatMatterHeadline,
    onSend: props.onSend,
    onAbortChat: props.onAbortChat,
    onDeleteChatMessage: props.onDeleteChatMessage,
    onEditChatMessage: props.onEditChatMessage,
    onClearContext: props.onClearContext,
    onContextMatterChange: props.onContextMatterChange,
    onOpenComposeSettings: props.onOpenComposeSettings,
    onOpenMemoryInspector: props.onOpenMemoryInspector,
    onOpenApiWizard: props.onOpenApiWizard,
    composeModelHint: props.composeModelHint,
    composeModelQuickTestBusy: props.composeModelQuickTestBusy,
    onComposeModelQuickTest: props.onComposeModelQuickTest,
    composeModelConfigured:
      props.health?.modelConfigured === true
        ? true
        : props.health?.modelConfigured === false
          ? false
          : undefined,
    modelCatalog: props.modelCatalog,
    selectedModelId: props.selectedModelId,
    onModelSelect: props.onModelSelect,
    allowWebSearch: props.allowWebSearch,
    webSearchPolicyBlocked: props.health?.webSearchPolicyBlocked,
    onAllowWebSearchChange: props.onAllowWebSearchChange,
    queuedMessages: props.queuedMessages,
    cancelQueuedMessage: props.cancelQueuedMessage,
    onOpenTaskDrawer: props.onOpenTaskDrawer,
    onOpenNeedsDecisionDesk: props.onOpenNeedsDecisionDesk ?? props.onOpenActionHub,
    composeExtras: props.composeExtras,
    onCreateMatter: props.onCreateMatter,
    onOpenAgentsWorkflows: () => {
      if (props.onOpenAgentsWorkflows) {
        props.onOpenAgentsWorkflows();
        return;
      }
      props.onOpenWorkflowLibrary?.();
    },
    showEmptyMatterGuide: props.showEmptyMatterGuide,
    chatSessionsInSidebar: props.chatSessionsInSidebar,
  };
}

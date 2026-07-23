/**
 * Narrow LawmindMainBodyContentProps → per-view props.
 * Keeps branch JSX free of 100-field destructure noise (R-P1-2).
 */

import { isValidMatterId } from "../../../../../src/lawmind/cases/matter-id.ts";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import type { MatterViewProps } from "./MatterView";
import type { MeetingViewProps } from "./MeetingView";
import type { ReviewViewProps } from "./ReviewView";
import type { AgentFleetViewProps } from "./AgentFleetView";

function openAgentsWorkflows(props: LawmindMainBodyContentProps, matterId?: string): void {
  if (props.onOpenAgentsWorkflows) {
    props.onOpenAgentsWorkflows(matterId);
    return;
  }
  props.onOpenWorkflowLibrary?.();
}

function openNeedsDecisionDesk(
  props: LawmindMainBodyContentProps,
  target?: import("../lawmind-agents-desk").NeedsDecisionDeskTarget,
): void {
  (props.onOpenNeedsDecisionDesk ?? props.onOpenActionHub ?? (() => undefined))(target);
}

function normalizeMatterId(
  props: LawmindMainBodyContentProps,
  preferContext: boolean,
): string | null {
  const raw = (
    preferContext
      ? (props.contextMatterId ?? props.selectedMatterKey)
      : props.selectedMatterKey
  )?.trim();
  return raw && isValidMatterId(raw) ? raw : null;
}

export function pickMatterViewProps(props: LawmindMainBodyContentProps): MatterViewProps | null {
  if (!props.config) {
    return null;
  }
  return {
    apiBase: props.config.apiBase,
    refreshVersion: props.matterRefreshVersion,
    assistantId: props.selectedAssistantId,
    selectedMatterKey: props.selectedMatterKey,
    tasks: props.tasks,
    history: props.history,
    workspaceDir: props.config.workspaceDir ?? null,
    projectDir: props.projectDir,
    assistantDisplayById: props.assistantDisplayById,
    onOpenShellDetail: props.onOpenShellDetail,
    formatShellRelativeTime: props.formatRelativeTime,
    legalStatusLabel: props.legalStatusLabel,
    taskBadgeClass: props.taskBadgeClass,
    historyBadgeClass: props.historyBadgeClass,
    onMatterCreated: props.onMatterCreated,
    onUseInChat: props.onUseInChat,
    onOpenWorkflowLibrary: () => openAgentsWorkflows(props),
    onOpenTopLevelMeeting: props.onOpenTopLevelMeeting,
    onOpenNeedsDecisionDesk: (target) => openNeedsDecisionDesk(props, target),
    onOpenChatSession: props.onOpenChatSession,
    onOpenReview: props.onOpenReviewFromMatter,
  };
}

export function pickMeetingViewProps(props: LawmindMainBodyContentProps): MeetingViewProps {
  return {
    config: props.config,
    matterId: normalizeMatterId(props, true),
    matterOptions: props.meetingMatterOptions,
    shellAssistantId: props.selectedAssistantId,
    projectDir: props.projectDir,
    agendaFilePins: props.fileChatContextItems,
    onAddAgendaFile: props.onAddFileToChatContext,
    onRemoveAgendaFile: props.onRemoveFileChatPill,
    onSelectMatterScope: props.onSelectMeetingMatterScope,
  };
}

export function pickReviewViewProps(props: LawmindMainBodyContentProps): ReviewViewProps | null {
  if (!props.config) {
    return null;
  }
  return {
    apiBase: props.config.apiBase,
    assistantId: props.selectedAssistantId,
    initialTaskId: props.reviewFocusTaskId,
    initialMatterId: props.reviewFocusMatterId,
    initialStatusFilter: props.reviewFocusStatus,
    initialListMode: props.reviewFocusListMode,
    externalRefreshToken: props.reviewRefreshVersion,
    returnMatterId: props.reviewLaunchedFromMatter ? props.reviewFocusMatterId : null,
    paneVisibility: props.reviewPaneVisibility,
    onReturnToMatter: props.onReturnToMatter,
    onShowArtifact: props.onShowArtifact,
    onRecordsChanged: props.onRecordsChanged,
    onGoToChat: props.onGoToChat,
    onOpenAgentsDesk: props.onOpenAgentsDeskFromReview,
    onRevisionJobQueued: props.onRevisionJobQueued,
    onToggleReviewPane: props.onToggleReviewPane,
  };
}

export function pickAgentFleetViewProps(props: LawmindMainBodyContentProps): AgentFleetViewProps {
  return {
    config: props.config,
    sessionId: props.activeChatSessionId,
    sessionRequiresActions: props.sessionRequiresActions,
    assistantDisplayById: props.assistantDisplayById,
    onRefreshActionSummary: props.onRefreshActionSummary,
    onChatResumeComplete: props.onChatResumeComplete,
    onOpenChatSession: props.onOpenChatSession,
    onOpenReview: (taskId, matterId) => {
      const tid = taskId?.trim();
      if (tid) {
        props.onOpenReviewFromWorkItem(tid, matterId);
        return;
      }
      props.onOpenReviewFromWorkspace({ matterId });
    },
    onOpenMemoryInspector: props.onOpenMemoryInspector,
    onShowArtifact: props.onShowArtifact,
    agentsDeskTab: props.agentsDeskTab,
    onAgentsDeskTabChange: props.onAgentsDeskTabChange,
    needsDecisionFocus: props.needsDecisionFocus,
    onClearNeedsDecisionFocus: props.onClearNeedsDecisionFocus,
    focusTarget: props.agentsDeskFocusTarget,
    onFocusTargetConsumed: props.onAgentsDeskFocusTargetConsumed,
    collabSummarySettings: props.collabSummarySettings,
    selectedAssistantId: props.selectedAssistantId,
    delegations: props.delegations,
    collabEvents: props.collabEvents,
    gateHistory: props.gateHistory,
    formatRelativeTime: props.formatRelativeTime,
    onRefreshCollaboration: props.onRefreshCollaboration,
    onOpenDelegationTargetChat: props.onOpenDelegationTargetChat,
    modelCatalog: props.modelCatalog,
    selectedModelId: props.selectedModelId,
    onModelSelect: props.onModelSelect,
    onOpenComposeSettings: props.onOpenComposeSettings,
    onOpenApiWizard: props.onOpenApiWizard,
    composeModelHint: props.composeModelHint,
    composeModelQuickTestBusy: props.composeModelQuickTestBusy,
    onComposeModelQuickTest: props.onComposeModelQuickTest,
    healthModelConfigured:
      props.health?.modelConfigured === true
        ? true
        : props.health?.modelConfigured === false
          ? false
          : undefined,
    chatLoading: props.loading,
    workflowModelLabel: props.workflowModelLabel,
    onReconnectLocalService: props.onReconnectLocalService,
    localServiceReconnecting: props.localServiceReconnecting,
  };
}

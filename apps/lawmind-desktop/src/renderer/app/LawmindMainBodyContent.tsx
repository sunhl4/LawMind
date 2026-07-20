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
import type { AgentsDeskTab } from "../lawmind-agents-desk";
import type { LawMindRequiresAction, LawMindRequiresActionDecision } from "../lawmind-requires-action";
import type { ChatMsg } from "../lawmind-chat";
import type { FileChatContextItem } from "../lawmind-file-chat-context";
import type { LawmindComposeExtras } from "../useLawmindComposeExtras";
import type { LawmindHealthState } from "../useLawmindAppBootstrapEffects";
import { MatterView } from "./MatterView";
import { ReviewView } from "./ReviewView";
import { AgentFleetView } from "./AgentFleetView";
import { AutomationsView } from "./AutomationsView";
import { MeetingView } from "./MeetingView";
import { LawmindWorkspaceMainPane } from "./LawmindWorkspaceMainPane";
import { LawmindWorkspaceBootstrapGate } from "./LawmindWorkspaceBootstrapGate";
import { pickWorkspaceMainPaneProps } from "./pickWorkspaceMainPaneProps";
import {
  pickAgentFleetViewProps,
  pickAutomationsViewProps,
  pickMatterViewProps,
  pickMeetingViewProps,
  pickReviewViewProps,
} from "./pickMainBodyBranchProps";
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
  /** @deprecated Prefer onOpenAgentsWorkflows */
  onOpenWorkflowLibrary?: () => void;
  /** Open top-level meeting desk scoped to a matter (from matter cockpit). */
  onOpenTopLevelMeeting?: (matterId: string) => void;
  meetingMatterOptions?: Array<{ id: string; title: string }>;
  onSelectMeetingMatterScope?: (matterId: string | null) => void;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReviewFromMatter: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  onOpenReviewFromWorkItem: (taskId: string, matterId?: string) => void;
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
  agentsDeskTab: AgentsDeskTab;
  onAgentsDeskTabChange: (tab: AgentsDeskTab) => void;
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
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
  onAddFileToChatContext?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
  contextTaskId: string | null;
  onOpenReviewFromWorkspace: (target?: { taskId?: string; matterId?: string }) => void;
  onDelegateAssist: () => void;
  delegateAssistEnabled: boolean;
  revisionBackgroundActive: boolean;
  onResumeRequiresAction: (
    action: LawMindRequiresAction,
    decision: LawMindRequiresActionDecision,
    clarificationDraft?: Record<string, string>,
    editedArgs?: Record<string, unknown>,
  ) => void | Promise<void>;
  input: string;
  error: string | null;
  contextMatterId: string | null;
  chatMatterHeadline: string | null;
  onSend: () => void | Promise<void>;
  onAbortChat: () => void;
  onClearContext: () => void;
  onContextMatterChange?: (matterId: string | null) => void;
  allowWebSearch: boolean;
  onAllowWebSearchChange: (enabled: boolean) => void;
  queuedMessages: string[];
  cancelQueuedMessage: (index: number) => void;
  onOpenTaskDrawer: () => void;
  onOpenNeedsDecisionDesk?: () => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenActionHub?: () => void;
  onOpenReviewFromAutomation?: (taskId: string, matterId?: string) => void;
  onOpenAgentsWorkflows?: (matterId?: string) => void;
  composeExtras: LawmindComposeExtras;
  onCreateMatter?: () => void;
  showEmptyMatterGuide?: boolean;
  /** Session switcher is in the left rail; hide top chat tabs. */
  chatSessionsInSidebar?: boolean;
  activeChatSessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  onRefreshActionSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onSpawnPreset?: (preset: import("../lawmind-agent-fleet-api").AgentPreset) => void;
};

export function LawmindMainBodyContent(props: LawmindMainBodyContentProps) {
  const { mainView, matterCockpitOpen } = useLawmindShellNavigationContext();

  if (mainView === "workspace" && matterCockpitOpen && props.config) {
    const matterProps = pickMatterViewProps(props);
    return matterProps ? <MatterView {...matterProps} /> : null;
  }
  if (mainView === "meeting") {
    return <MeetingView {...pickMeetingViewProps(props)} />;
  }
  if (mainView === "review" && props.config) {
    const reviewProps = pickReviewViewProps(props);
    return reviewProps ? <ReviewView {...reviewProps} /> : null;
  }
  if (mainView === "agents") {
    return <AgentFleetView {...pickAgentFleetViewProps(props)} />;
  }
  if (mainView === "automations") {
    return <AutomationsView {...pickAutomationsViewProps(props)} />;
  }
  if (mainView === "workspace" && !matterCockpitOpen && !props.config) {
    return (
      <LawmindWorkspaceBootstrapGate error={props.error} onOpenApiWizard={props.onOpenApiWizard} />
    );
  }
  return <LawmindWorkspaceMainPane {...pickWorkspaceMainPaneProps(props)} />;
}

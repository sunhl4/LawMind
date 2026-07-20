import { describe, expect, it, vi } from "vitest";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import {
  pickAgentFleetViewProps,
  pickAutomationsViewProps,
  pickMeetingViewProps,
  pickMatterViewProps,
  pickReviewViewProps,
} from "./pickMainBodyBranchProps";

function baseProps(
  overrides: Partial<LawmindMainBodyContentProps> = {},
): LawmindMainBodyContentProps {
  return {
    config: {
      apiBase: "http://127.0.0.1:9",
      workspaceDir: "/tmp/ws",
    } as LawmindMainBodyContentProps["config"],
    contextMatterId: "demo-matter",
    selectedMatterKey: "demo-matter",
    selectedAssistantId: "asst-1",
    matterRefreshVersion: 1,
    tasks: [],
    history: [],
    projectDir: null,
    assistantDisplayById: {},
    onOpenShellDetail: () => {},
    formatRelativeTime: () => "",
    legalStatusLabel: () => "",
    taskBadgeClass: () => "",
    historyBadgeClass: () => "",
    onMatterCreated: () => {},
    onUseInChat: () => {},
    meetingMatterOptions: [],
    fileChatContextItems: [],
    onAddFileToChatContext: () => {},
    onRemoveFileChatPill: () => {},
    onSelectMeetingMatterScope: () => {},
    reviewFocusTaskId: null,
    reviewFocusMatterId: null,
    reviewFocusStatus: null,
    reviewFocusListMode: null,
    reviewRefreshVersion: 0,
    reviewLaunchedFromMatter: false,
    reviewPaneVisibility: {},
    onReturnToMatter: () => {},
    onShowArtifact: () => {},
    onRecordsChanged: () => {},
    onGoToChat: () => {},
    onRevisionJobQueued: () => {},
    onToggleReviewPane: () => {},
    activeChatSessionId: null,
    sessionRequiresActions: [],
    delegateAssistEnabled: false,
    onRefreshActionSummary: () => {},
    onChatResumeComplete: () => {},
    onCreateNewChatSession: async () => {},
    onOpenChatSession: () => {},
    onOpenReviewFromMatter: () => {},
    onOpenReviewFromWorkItem: () => {},
    onOpenReviewFromAutomation: () => {},
    onOpenTopLevelMeeting: () => {},
    onSpawnPreset: () => {},
    agentsDeskTab: "active",
    onAgentsDeskTabChange: () => {},
    needsDecisionFocus: false,
    onClearNeedsDecisionFocus: () => {},
    collabSummarySettings: {},
    delegations: [],
    collabEvents: [],
    gateHistory: [],
    onRefreshCollaboration: async () => {},
    onOpenDelegationTargetChat: () => {},
    modelCatalog: [],
    selectedModelId: null,
    onModelSelect: () => {},
    onOpenComposeSettings: () => {},
    onOpenApiWizard: () => {},
    composeModelHint: null,
    composeModelQuickTestBusy: false,
    onComposeModelQuickTest: async () => {},
    health: null,
    loading: false,
    workflowModelLabel: null,
    onReconnectLocalService: async () => {},
    localServiceReconnecting: false,
    onDelegateAssist: async () => {},
    ...overrides,
  } as LawmindMainBodyContentProps;
}

describe("pickMainBodyBranchProps", () => {
  it("pickMatterViewProps returns null without config", () => {
    expect(pickMatterViewProps(baseProps({ config: null }))).toBeNull();
  });

  it("pickMeetingViewProps wires agenda pin handlers and normalizes matter id", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const props = pickMeetingViewProps(
      baseProps({
        contextMatterId: "  demo-matter  ",
        onAddFileToChatContext: onAdd,
        onRemoveFileChatPill: onRemove,
        fileChatContextItems: [
          { id: "p1", root: "workspace", relPath: "a.md", kind: "file" },
        ],
      }),
    );
    expect(props.matterId).toBe("demo-matter");
    expect(props.agendaFilePins).toHaveLength(1);
    expect(props.onAddAgendaFile).toBe(onAdd);
    expect(props.onRemoveAgendaFile).toBe(onRemove);
  });

  it("pickMeetingViewProps treats invalid matter id as null", () => {
    const props = pickMeetingViewProps(
      baseProps({ contextMatterId: "", selectedMatterKey: "???" }),
    );
    expect(props.matterId).toBeNull();
  });

  it("pickReviewViewProps returns null without config", () => {
    expect(pickReviewViewProps(baseProps({ config: null }))).toBeNull();
  });

  it("pickAgentFleetViewProps falls back openAgentsWorkflows to workflow library", () => {
    const onOpenWorkflowLibrary = vi.fn();
    const props = pickAgentFleetViewProps(
      baseProps({
        onOpenAgentsWorkflows: undefined,
        onOpenWorkflowLibrary,
      }),
    );
    props.onOpenAgentsWorkflows?.();
    expect(onOpenWorkflowLibrary).toHaveBeenCalledOnce();
  });

  it("pickAutomationsViewProps scopes matter options to current id", () => {
    const props = pickAutomationsViewProps(baseProps({ contextMatterId: "demo-matter" }));
    expect(props.matterId).toBe("demo-matter");
    expect(props.matterOptions).toEqual([{ id: "demo-matter", title: "demo-matter" }]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import {
  pickAgentFleetViewProps,
  pickLawyerWorkbenchProps,
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

  it("pickAgentFleetViewProps wires onOpenReview to work item or workspace", () => {
    const onOpenReviewFromWorkItem = vi.fn();
    const onOpenReviewFromWorkspace = vi.fn();
    const props = pickAgentFleetViewProps(
      baseProps({ onOpenReviewFromWorkItem, onOpenReviewFromWorkspace }),
    );
    props.onOpenReview("task-1", "matter-1");
    expect(onOpenReviewFromWorkItem).toHaveBeenCalledWith("task-1", "matter-1");
    props.onOpenReview(undefined, "matter-2");
    expect(onOpenReviewFromWorkspace).toHaveBeenCalledWith({ matterId: "matter-2" });
  });

  it("pickLawyerWorkbenchProps returns null without config and wires chat/create", () => {
    expect(pickLawyerWorkbenchProps(baseProps({ config: null }))).toBeNull();
    const onGoToChat = vi.fn();
    const onSelectMatterKey = vi.fn();
    const onCreateMatter = vi.fn();
    const props = pickLawyerWorkbenchProps(
      baseProps({ onGoToChat, onSelectMatterKey, onCreateMatter }),
    );
    expect(props?.apiBase).toBe("http://127.0.0.1:9");
    props?.onSelectMatter("demo-matter");
    expect(onSelectMatterKey).toHaveBeenCalledWith("demo-matter");
    props?.onGoToChat({ matterId: "demo-matter", prompt: "【办件】" });
    expect(onGoToChat).toHaveBeenCalledWith({
      taskId: "",
      matterId: "demo-matter",
      prompt: "【办件】",
    });
    props?.onCreateMatter?.();
    expect(onCreateMatter).toHaveBeenCalled();
  });

  it("pickLawyerWorkbenchProps wires review, artifact and needs-decision", () => {
    const onOpenReviewFromMatter = vi.fn();
    const onOpenReviewFromWorkspace = vi.fn();
    const onOpenNeedsDecisionDesk = vi.fn();
    const onShowArtifact = vi.fn();
    const props = pickLawyerWorkbenchProps(
      baseProps({
        onOpenReviewFromMatter,
        onOpenReviewFromWorkspace,
        onOpenNeedsDecisionDesk,
        onShowArtifact,
      }),
    );
    props?.onOpenReview?.({ matterId: "m1", taskId: "t1" });
    expect(onOpenReviewFromMatter).toHaveBeenCalledWith({ taskId: "t1", matterId: "m1" });
    props?.onOpenReview?.({ matterId: "m2" });
    expect(onOpenReviewFromWorkspace).toHaveBeenCalledWith({ matterId: "m2" });
    props?.onOpenNeedsDecision?.("m1");
    expect(onOpenNeedsDecisionDesk).toHaveBeenCalledWith({ matterId: "m1" });
    props?.onShowArtifact?.("out/a.docx");
    expect(onShowArtifact).toHaveBeenCalledWith("out/a.docx");
    expect(props?.onReconnectLocalService).toBeTypeOf("function");
    expect(props?.localServiceReconnecting).toBe(false);
  });
});

/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindMainBodyContent, type LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import { mockComposeExtras } from "../test/mock-compose-extras";
import { LawmindShellProviders } from "./LawmindShellContexts";

function minimalWorkspaceProps(
  overrides: Partial<LawmindMainBodyContentProps> = {},
): LawmindMainBodyContentProps {
  const noop = () => {};
  return {
    config: null,
    matterRefreshVersion: 0,
    selectedAssistantId: "a1",
    selectedMatterKey: null,
    tasks: [],
    history: [],
    projectDir: null,
    assistantDisplayById: {},
    onOpenShellDetail: noop,
    formatRelativeTime: () => "",
    legalStatusLabel: () => "",
    taskBadgeClass: () => "",
    historyBadgeClass: () => "",
    onMatterCreated: noop,
    onUseInChat: noop,
    onOpenWorkflowLibrary: noop,
    onOpenChatSession: noop,
    onOpenReviewFromMatter: noop,
    onOpenReviewFromWorkItem: noop,
    reviewFocusTaskId: null,
    reviewFocusMatterId: null,
    reviewFocusStatus: "all",
    reviewFocusListMode: "all",
    reviewRefreshVersion: 0,
    reviewLaunchedFromMatter: false,
    reviewPaneVisibility: { meta: true, editor: true, preview: true },
    onReturnToMatter: noop,
    onShowArtifact: noop,
    onRecordsChanged: noop,
    onGoToChat: noop,
    onRevisionJobQueued: noop,
    onToggleReviewPane: noop,
    collabSummarySettings: null,
    delegations: [],
    collabEvents: [],
    gateHistory: [],
    onRefreshCollaboration: noop,
    onOpenDelegationTargetChat: noop,
    agentsDeskTab: "active",
    onAgentsDeskTabChange: noop,
    modelCatalog: [],
    selectedModelId: "m1",
    onModelSelect: noop,
    onOpenComposeSettings: noop,
    onOpenApiWizard: noop,
    composeModelHint: null,
    composeModelQuickTestBusy: false,
    onComposeModelQuickTest: noop,
    health: null,
    loading: false,
    workflowModelLabel: "m1",
    onReconnectLocalService: noop,
    localServiceReconnecting: false,
    canUseFilesystemBridge: false,
    setFileEditorHost: noop,
    wsShowEditor: true,
    onShowEditorPane: noop,
    wsShowChat: true,
    onShowChatPane: noop,
    onWsChatSplitResize: noop,
    wsChatColWidth: 380,
    chatSessionList: [],
    chatSessionsLoading: false,
    onSelectChatSession: noop,
    onCreateNewChatSession: noop,
    onRenameChatSession: noop,
    onDeleteChatSession: noop,
    currentMessages: [],
    copiedMessageIndex: null,
    messagesEndRef: { current: null },
    onCopyMessage: noop,
    onInputChange: noop,
    textareaRef: { current: null },
    onSendClarificationMessage: noop,
    streamCompactLabels: [],
    fileChatContextItems: [],
    onRemoveFileChatPill: noop,
    onClearFileChatPills: noop,
    contextTaskId: null,
    onOpenReviewFromWorkspace: noop,
    onDelegateAssist: noop,
        delegateAssistEnabled: false,
    revisionBackgroundActive: false,
    onResumeRequiresAction: noop,
    input: "",
    error: null,
    contextMatterId: null,
    chatMatterHeadline: null,
    onSend: noop,
    onAbortChat: noop,
    onClearContext: noop,
    allowWebSearch: false,
    onAllowWebSearchChange: noop,
    queuedMessages: [],
    cancelQueuedMessage: noop,
    onOpenTaskDrawer: noop,
    onOpenActionHub: noop,
    composeExtras: mockComposeExtras(),
    ...overrides,
  };
}

describe("LawmindMainBodyContent workspace bootstrap", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders bootstrap gate instead of chat when config is missing", async () => {
    await act(async () => {
      root.render(
        <LawmindShellProviders
          navigation={{
            mainView: "workspace",
            matterCockpitOpen: false,
            settingsOpen: false,
          }}
          chatSession={{
            selectedAssistantId: "a1",
            activeChatSessionId: undefined,
          }}
        >
          <LawmindMainBodyContent {...minimalWorkspaceProps()} />
        </LawmindShellProviders>,
      );
    });
    expect(host.querySelector(".lm-workspace-bootstrap-gate")).not.toBeNull();
    expect(host.querySelector(".lm-workspace-unified")).toBeNull();
  });
});

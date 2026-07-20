/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAssistantDraft } from "../lawmind-assistant-editor";
import { mockComposeExtras } from "../test/mock-compose-extras";
import { LawmindAppRootView, type LawmindAppRootViewProps } from "./LawmindAppRootView";

function minimalProps(overrides: Partial<LawmindAppRootViewProps> = {}): LawmindAppRootViewProps {
  const noop = () => {};
  const base = {
    mainView: "workspace" as const,
    overlayProps: {
      showWizard: false,
      wizApiKey: "",
      setWizApiKey: noop,
      wizHasExistingKey: false,
      wizBaseUrl: "",
      setWizBaseUrl: noop,
      wizModel: "",
      setWizModel: noop,
      wizWorkspace: "",
      wizRetrievalMode: "single" as const,
      setWizRetrievalMode: noop,
      wizError: null,
      wizBusy: false,
      onPickWorkspace: noop,
      onWizardCancel: noop,
      onWizardSave: noop,
      detailOpen: false,
      detailKind: "task" as const,
      detailId: null,
      detailLoading: false,
      detailError: null,
      detailTask: null,
      detailDraft: null,
      detailCitationIntegrity: null,
      detailCheckpoints: null,
      detailExecutionPlan: null,
      canUseFilesystemBridge: false,
      apiBase: undefined,
      onCloseDetail: noop,
      onPreviewArtifact: noop,
      onOpenOutputInFolder: noop,
      onUseTaskContext: noop,
      showAssistantEditor: false,
      editingAssistantId: null,
      assistantDraft: createAssistantDraft("create", []),
      presets: [],
      assistants: [],
      asstBusy: false,
      asstError: null,
      onAssistantDraftChange: noop,
      onCloseAssistantEditor: noop,
      onSaveAssistant: noop,
      showHelp: false,
      onCloseHelp: noop,
      onOpenWorkflowLibrary: undefined,
      onOpenAdvancedSettings: noop,
      onFirstRunSeedReady: noop,
      composeTextareaRef: { current: null },
      config: null,
    },
    settingsPanelProps: {
      open: false,
      config: null,
      projectDir: null,
      workspaceLabel: "",
      health: { modelConfigured: false },
      collabSummarySettings: { collaborationEnabled: true, delegationCount: 0 },
      assistants: [],
      selectedAssistantId: "a1",
      onSelectAssistantId: noop,
      selectedAssistant: undefined,
      selectedAssistantStats: undefined,
      retrievalLabel: "",
      retrievalSaving: false,
      draftWithModelSaving: false,
      onClose: noop,
      onOpenNewAssistant: noop,
      onOpenEditAssistant: noop,
      onRemoveAssistant: noop,
      onApplyRetrievalMode: noop,
      onApplyDraftWithModelEnabled: noop,
      onReconnectLocalService: noop,
      localServiceReconnecting: false,
      onOpenApiWizard: noop,
      modelProviders: [],
      platformProviders: [],
      platformMode: "none" as const,
      selectedModelId: "m1",
      customModels: [],
      modelCatalog: [],
      onModelsChanged: noop,
      onPickProject: noop,
      onClearProject: noop,
      onOpenCollaborationPage: noop,
      onPrefsChange: noop,
    },
    sidebarProps: {
      showAppSidebar: true,
      sidebarCollapsed: false,
      sidebarWidth: 280,
      showSidebarWorkbenchFiles: false,
      showExplorerSkeleton: false,
      onSidebarResizePointerDown: noop,
      onOpenSettings: noop,
      onCloseSettings: noop,
      settingsOpen: false,
      setFileExplorerHost: noop,
      actionSummaryTotal: 0,
      matterSidebarRows: [],
      selectedMatterKey: null,
      onSelectMatterKey: noop,
      onSelectMatterForCockpit: noop,
      matterCockpitOpen: false,
      mainView: "workspace" as const,
      onOpenActionHub: noop,
    },
    headerProps: {
      mainView: "workspace" as const,
      assistants: [],
      selectedAssistantId: "a1",
      onSelectAssistantId: noop,
      matterCockpitOpen: false,
      onExitMatterCockpit: noop,
      onSetMainView: noop,
            apiBase: undefined,
      actionSummaryTotal: 0,
      onOpenActionHub: noop,
      projectDir: null,
      currentMatterLabel: null,
      sidebarCollapsed: false,
      wsShowEditor: true,
      wsShowChat: true,
      canUseFilesystemBridge: false,
      onToggleSidebar: noop,
      onToggleEditor: noop,
      onToggleChat: noop,
      reviewPaneVisibility: { meta: true, editor: true, preview: true },
      onToggleReviewPane: noop,
      onOpenSettings: noop,
      onCloseSettings: noop,
      settingsOpen: false,
      showReadinessStrip: false,
      health: null,
      workspaceDir: undefined,
      localServiceReconnecting: false,
      modelCatalog: [],
      selectedModelId: "m1",
      onOpenApiWizard: noop,
      onOpenDoctor: noop,
      onVerifyModel: noop,
      composeModelQuickTestBusy: false,
    },
    mainBodyProps: {
      mainView: "workspace" as const,
      matterCockpitOpen: false,
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
      reviewFocusTaskId: null,
      reviewFocusMatterId: null,
      reviewFocusStatus: "all" as const,
      reviewFocusListMode: "all" as const,
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
      agentsDeskTab: "active" as const,
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
      activeChatSessionId: undefined,
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
      sessionByAssistant: {},
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
    },
    fileWorkbenchHostProps: null,
    dialogProps: {
      apiBase: undefined,
      delegateAssistOpen: false,
      onCloseDelegateAssist: noop,
      selectedAssistantId: "a1",
      activeChatSessionId: null,
      contextMatterId: null,
      delegateTaskDefault: "",
      assistants: [],
      delegations: [],
      modelCatalog: [],
      selectedModelId: "m1",
      onDelegated: noop,
      createMatterOpen: false,
      onCloseCreateMatter: noop,
      onCreateMatterSuccess: noop,
      matterDeleteOpen: null,
      onCloseMatterDelete: noop,
      onMatterDeleteSuccess: noop,
      onMatterListChanged: noop,
      taskDrawerOpen: false,
      onCloseTaskDrawer: noop,
    },
  };
  return { ...base, ...overrides } as LawmindAppRootViewProps;
}

describe("LawmindAppRootView", () => {
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

  it("renders skip link and main landmark", async () => {
    await act(async () => {
      root.render(<LawmindAppRootView {...minimalProps()} />);
    });
    expect(host.querySelector(".lm-skip-nav")?.textContent).toContain("跳到主内容");
    expect(host.querySelector("#main-content")).toBeTruthy();
  });

  it("adds review shell class on review mainView", async () => {
    await act(async () => {
      root.render(<LawmindAppRootView {...minimalProps({ mainView: "review" })} />);
    });
    expect(host.querySelector(".lm-shell-review")).toBeTruthy();
  });

  it("renders settings inside main body when open", async () => {
    await act(async () => {
      root.render(
        <LawmindAppRootView
          {...minimalProps({
            settingsPanelProps: {
              ...minimalProps().settingsPanelProps,
              open: true,
              initialSectionId: "models",
            },
          })}
        />,
      );
    });
    const main = host.querySelector("#main-content");
    expect(main?.classList.contains("lm-main-settings")).toBe(true);
    expect(main?.querySelector(".lm-settings-page")).toBeTruthy();
    expect(main?.querySelector(".lm-main-body")?.children.length).toBe(1);
    expect(main?.querySelector(".lm-settings-content-title")?.textContent).toContain("模型/API");
  });
});

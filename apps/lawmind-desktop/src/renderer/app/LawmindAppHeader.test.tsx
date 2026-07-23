/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindAppHeader } from "./LawmindAppHeader";
import type { EditionInfo } from "../use-edition";

const editionState: { current: EditionInfo } = {
  current: {
    edition: "solo",
    label: "独立律师版",
    source: "default",
    features: {
      acceptanceGateStrict: true,
      citationGateStrict: true,
      crossMatterRoadmap: false,
      crossMatterAcceptanceDashboard: false,
      collaborationSummary: false,
      complianceAuditExport: false,
      auditIntegrityExport: false,
      securitySbomPanel: false,
      qualityDashboardJsonExport: false,
      customDeliverableSpec: false,
      acceptancePackExport: false,
      strictDangerousToolApproval: false,
      reviewCampaignParallel: true,
      forcePeerReview: false,
    },
    citationMode: "assisted",
    loading: false,
  },
};

vi.mock("../use-edition", () => ({
  useEdition: () => editionState.current,
}));

describe("LawmindAppHeader", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    editionState.current = {
      ...editionState.current,
      edition: "solo",
      features: { ...editionState.current.features, collaborationSummary: false },
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders workspace tab selected by default", async () => {
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[
            {
              assistantId: "a1",
              displayName: "助手 A",
              introduction: "",
              presetKey: "general_default",
              createdAt: "",
              updatedAt: "",
              stats: { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
            },
          ]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
                    apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-tab-home"]')).toBeNull();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain("对话");
    expect(host.textContent).toContain("在办");
    expect(host.querySelector('[data-testid="lm-tab-meeting"]')?.textContent).toContain("会议室");
    expect(host.querySelector('[data-testid="lm-nav-more"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-tab-automations"]')).toBeNull();
    expect(host.textContent).not.toContain("审核");
    expect(host.querySelector('[data-testid="lm-tab-collaboration"]')).toBeNull();
  });

  it("opens 会议室 from top nav tab", async () => {
    const onSetMainView = vi.fn();
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={onSetMainView}
          apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    await act(async () => {
      (host.querySelector('[data-testid="lm-tab-meeting"]') as HTMLButtonElement).click();
    });
    expect(onSetMainView).toHaveBeenCalledWith("meeting");
  });

  it("shows 案件 tab as current when matter cockpit is open", async () => {
    const onExit = vi.fn();
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen
          onExitMatterCockpit={onExit}
          onSetMainView={vi.fn()}
                    apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel="chen-ac"
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat={false}
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-tab-matter"]')?.textContent).toContain("案件");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain("案件");
    expect(host.querySelector('[data-testid="lm-tab-workspace"]')?.getAttribute("aria-current")).toBeNull();
    expect(host.textContent).not.toContain("返回对话");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-tab-workspace"]')?.click();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("does not show a separate 协作 tab (merged into 在办)", async () => {
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
          apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-tab-collaboration"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-tab-agents"]')?.textContent).toContain("在办");
    expect(host.querySelector('[aria-label="功能模块"]')?.textContent).not.toContain("协作");
  });

  it("在办 header exposes sidebar hide/show toggle", async () => {
    const onToggleSidebar = vi.fn();
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="agents"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
          apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge
          onToggleSidebar={onToggleSidebar}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    const btn = host.querySelector<HTMLButtonElement>('[data-testid="lm-agents-toggle-sidebar"]');
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute("aria-label")).toBe("隐藏侧栏");
    await act(async () => {
      btn?.click();
    });
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("marks settings gear active when settingsOpen and sidebar unavailable", async () => {
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
                    apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    expect(host.querySelector(".lm-main-header-settings")).not.toBeNull();
    expect(host.querySelector('.lm-main-header-gear-btn[aria-pressed="true"]')).not.toBeNull();
  });

  it("omits header settings gear when sidebar is visible", async () => {
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
                    apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    expect(host.querySelector(".lm-main-header-gear-btn")).toBeNull();
    expect(host.querySelector('[aria-label="面板布局"]')).not.toBeNull();
  });

  it("shows back button and calls onCloseSettings when settingsOpen", async () => {
    const onCloseSettings = vi.fn();
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
                    apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={onCloseSettings}
          settingsOpen
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    const backBtn = host.querySelector(".lm-settings-back-btn") as HTMLButtonElement | null;
    expect(backBtn).not.toBeNull();
    expect(backBtn?.textContent).toContain("返回");
    backBtn?.click();
    expect(onCloseSettings).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".lm-tabs")).toBeNull();
  });

  it("never shows header 待我拍板 (inbox stays on sidebar / 在办)", async () => {
    const base = {
      assistants: [],
      selectedAssistantId: "a1",
      onSelectAssistantId: vi.fn(),
      matterCockpitOpen: false,
      onExitMatterCockpit: vi.fn(),
      onSetMainView: vi.fn(),
      apiBase: "http://127.0.0.1:8765",
      projectDir: null as string | null,
      currentMatterLabel: null as string | null,
      wsShowEditor: true,
      wsShowChat: true,
      canUseFilesystemBridge: false,
      onToggleSidebar: vi.fn(),
      onToggleEditor: vi.fn(),
      onToggleChat: vi.fn(),
      reviewPaneVisibility: { meta: true, editor: true, preview: true },
      onToggleReviewPane: vi.fn(),
      onOpenSettings: vi.fn(),
      onCloseSettings: vi.fn(),
      settingsOpen: false,
      showReadinessStrip: false,
      health: null,
      workspaceDir: "/tmp/ws",
      localServiceReconnecting: false,
      modelCatalog: [],
      selectedModelId: "m1",
      onOpenApiWizard: vi.fn(),
      onOpenDoctor: vi.fn(),
      onVerifyModel: vi.fn(),
      composeModelQuickTestBusy: false,
    };

    await act(async () => {
      root.render(
        <LawmindAppHeader {...base} mainView="workspace" sidebarCollapsed />,
      );
    });
    expect(host.querySelector(".lm-needs-decision-trigger")).toBeNull();
    expect(host.querySelector('[data-testid="lm-header-needs-decision"]')).toBeNull();

    await act(async () => {
      root.render(
        <LawmindAppHeader {...base} mainView="review" sidebarCollapsed={false} />,
      );
    });
    expect(host.querySelector(".lm-needs-decision-trigger")).toBeNull();
    expect(host.querySelector('[data-testid="lm-tab-agents"]')?.textContent?.trim()).toBe("在办");
  });

  it("shows weak matter chip when a case is linked", async () => {
    const onOpenMatterCockpit = vi.fn();
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[
            {
              assistantId: "a1",
              displayName: "助手 A",
              introduction: "",
              presetKey: "general_default",
              createdAt: "",
              updatedAt: "",
              stats: { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
            },
          ]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onOpenMatterCockpit={onOpenMatterCockpit}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
                    apiBase="http://127.0.0.1:8765"
          projectDir="/tmp/ws"
          currentMatterLabel="张三诉李四"
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    expect(host.querySelector('select[aria-label="选择助手"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="功能模块"]')?.textContent).toContain("对话");
    expect(host.querySelector('[aria-label="功能模块"]')?.textContent).toContain("在办");
    expect(host.querySelector('[aria-label="功能模块"]')?.textContent).not.toContain("协作");
    expect(host.querySelector('[aria-label="面板布局"]')).not.toBeNull();
    const matterChip = host.querySelector('[data-testid="lm-open-matter-cockpit"]') as HTMLButtonElement | null;
    expect(matterChip?.textContent).toContain("张三诉李四");
    matterChip?.click();
    expect(onOpenMatterCockpit).toHaveBeenCalledTimes(1);
  });

  it("does not show create-matter chip when no matter is linked", async () => {
    await act(async () => {
      root.render(
        <LawmindAppHeader
          mainView="workspace"
          assistants={[]}
          selectedAssistantId="a1"
          onSelectAssistantId={vi.fn()}
          matterCockpitOpen={false}
          onExitMatterCockpit={vi.fn()}
          onSetMainView={vi.fn()}
                    apiBase="http://127.0.0.1:8765"
          projectDir={null}
          currentMatterLabel={null}
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
          reviewPaneVisibility={{ meta: true, editor: true, preview: true }}
          onToggleReviewPane={vi.fn()}
          onOpenSettings={vi.fn()}
          onCloseSettings={vi.fn()}
          settingsOpen={false}
          showReadinessStrip={false}
          health={null}
          workspaceDir="/tmp/ws"
          localServiceReconnecting={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
          onOpenDoctor={vi.fn()}
          onVerifyModel={vi.fn()}
          composeModelQuickTestBusy={false}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-header-create-matter"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-open-matter-cockpit"]')).toBeNull();
  });
});

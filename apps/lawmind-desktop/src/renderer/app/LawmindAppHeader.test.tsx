/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindAppHeader } from "./LawmindAppHeader";

describe("LawmindAppHeader", () => {
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
          onOpenCollaborationOverview={vi.fn()}
          onOpenReviewTab={vi.fn()}
          apiBase="http://127.0.0.1:8765"
          actionSummaryTotal={0}
          onOpenActionHub={vi.fn()}
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
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain("对话");
  });

  it("marks settings gear active when settingsOpen", async () => {
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
          onOpenCollaborationOverview={vi.fn()}
          onOpenReviewTab={vi.fn()}
          apiBase="http://127.0.0.1:8765"
          actionSummaryTotal={0}
          onOpenActionHub={vi.fn()}
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
          onOpenCollaborationOverview={vi.fn()}
          onOpenReviewTab={vi.fn()}
          apiBase="http://127.0.0.1:8765"
          actionSummaryTotal={0}
          onOpenActionHub={vi.fn()}
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
});

/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLawmindAppHeaderProps } from "./useLawmindAppHeaderProps";
import { resetSettingsPanelStoreForTest, useSettingsPanelStore } from "../stores/settings-panel-store";

function headerInput(): Parameters<typeof useLawmindAppHeaderProps>[0] {
  return {
    mainView: "workspace",
    assistants: [],
    selectedAssistantId: "assistant-default",
    setSelectedAssistantId: vi.fn(),
    matterCockpitOpen: false,
    setMatterCockpitOpen: vi.fn(),
    setMainView: vi.fn(),
    apiBase: "http://127.0.0.1:9",
    projectDir: null,
    currentMatterLabel: null,
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    wsShowEditor: true,
    setWsShowEditor: vi.fn(),
    wsShowChat: true,
    setWsShowChat: vi.fn(),
    canUseFilesystemBridge: true,
    health: null,
    workspaceDir: undefined,
    localServiceReconnecting: false,
    modelCatalog: [],
    selectedModelId: "model-default",
    openApiWizard: vi.fn(),
    composeModelQuickTest: vi.fn(),
    composeModelQuickTestBusy: false,
  };
}

describe("useLawmindAppHeaderProps", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    resetSettingsPanelStoreForTest();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetSettingsPanelStoreForTest();
  });

  it("keeps header settingsOpen in sync when the settings store toggles", async () => {
    const seen: boolean[] = [];

    function Harness() {
      const props = useLawmindAppHeaderProps(headerInput());
      seen.push(props.settingsOpen);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    expect(seen.at(-1)).toBe(false);

    await act(async () => {
      useSettingsPanelStore.getState().setSettingsPanel(true, "models");
    });
    expect(seen.at(-1)).toBe(true);

    await act(async () => {
      useSettingsPanelStore.getState().setSettingsPanel(false);
    });
    expect(seen.at(-1)).toBe(false);
  });
});

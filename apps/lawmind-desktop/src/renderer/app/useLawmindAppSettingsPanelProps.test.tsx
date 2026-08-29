/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLawmindAppSettingsPanelProps } from "./useLawmindAppSettingsPanelProps";

describe("useLawmindAppSettingsPanelProps", () => {
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

  it("forwards settings deep-link section and scroll anchor", async () => {
    const captured: ReturnType<typeof useLawmindAppSettingsPanelProps>[] = [];

    function Harness() {
      captured.push(
        useLawmindAppSettingsPanelProps({
        showSettings: true,
        setShowSettings: vi.fn(),
        settingsSectionId: "models",
        settingsScrollAnchor: "lawmind-settings-memory-truth",
        config: null,
        projectDir: null,
        workspaceLabel: "default",
        health: null,
        collabSummarySettings: { collaborationEnabled: true, delegationCount: 0 },
        selectedAssistantId: "assistant-default",
        setSelectedAssistantId: vi.fn(),
        selectedAssistant: undefined,
        selectedAssistantStats: undefined,
        retrievalLabel: "single",
        retrievalSaving: false,
        draftWithModelSaving: false,
        openNewAssistant: vi.fn(),
        openEditAssistant: vi.fn(),
        removeAssistant: vi.fn(),
        applyRetrievalMode: vi.fn(),
        applyDraftWithModelEnabled: vi.fn(),
        reconnectLocalService: vi.fn(),
        localServiceReconnecting: false,
        openApiWizard: vi.fn(),
        modelProviders: [],
        platformProviders: [],
        platformMode: "none",
        selectedModelId: "model-default",
        modelCatalog: [],
        refreshModelsCatalog: vi.fn(),
        pickProject: vi.fn(),
        clearProject: vi.fn(),
        setAgentsDeskTab: vi.fn(),
        setMainView: vi.fn(),
        assistants: [],
        onPrefsChange: vi.fn(),
      }),
      );
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]?.initialSectionId).toBe("models");
    expect(captured[0]?.scrollAnchorId).toBe("lawmind-settings-memory-truth");
  });
});

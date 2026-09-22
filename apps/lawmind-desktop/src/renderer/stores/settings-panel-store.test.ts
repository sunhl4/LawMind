import { describe, expect, it, beforeEach, vi } from "vitest";
import { resetSettingsPanelStoreForTest, useSettingsPanelStore } from "./settings-panel-store";
import * as settingsNav from "../lawmind-settings-nav";

describe("settings-panel-store", () => {
  beforeEach(() => {
    resetSettingsPanelStoreForTest();
  });

  it("starts closed with default section", () => {
    expect(useSettingsPanelStore.getState().open).toBe(false);
    expect(useSettingsPanelStore.getState().sectionId).toBe(settingsNav.LAWMIND_SETTINGS_DEFAULT_SECTION);
  });

  it("opens with an explicit section", () => {
    useSettingsPanelStore.getState().setSettingsPanel(true, "doctor");
    expect(useSettingsPanelStore.getState().open).toBe(true);
    expect(useSettingsPanelStore.getState().sectionId).toBe("doctor");
  });

  it("opens with stored section when no section is given", () => {
    vi.spyOn(settingsNav, "readStoredSettingsSection").mockReturnValue("memory");
    useSettingsPanelStore.getState().setSettingsPanel(true);
    expect(useSettingsPanelStore.getState().sectionId).toBe("memory");
  });

  it("closes with function updater and clears scroll anchor", () => {
    useSettingsPanelStore.getState().setSettingsPanel(true, "models", "lawmind-settings-memory-truth");
    useSettingsPanelStore.getState().setSettingsPanel((prev) => !prev);
    expect(useSettingsPanelStore.getState().open).toBe(false);
    expect(useSettingsPanelStore.getState().scrollAnchorId).toBeUndefined();
  });
});

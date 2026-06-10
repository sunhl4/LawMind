import { describe, expect, it } from "vitest";
import {
  filterSettingsNavGroups,
  firstSettingsNavMatch,
  lawmindSettingsSectionFromDomId,
  readStoredSettingsSection,
  settingsNavItem,
  SETTINGS_NAV_FLAT,
} from "./lawmind-settings-nav.js";

describe("lawmind-settings-nav", () => {
  it("maps legacy dom ids to section ids", () => {
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-doctor")).toBe("doctor");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-usage")).toBe("doctor");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-models")).toBe("models");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-memory")).toBe("memory");
  });

  it("exposes metadata for every nav item", () => {
    for (const item of SETTINGS_NAV_FLAT) {
      const meta = settingsNavItem(item.id);
      expect(meta?.label).toBeTruthy();
      expect(meta?.description).toBeTruthy();
    }
  });

  it("returns a valid default section id", () => {
    expect(SETTINGS_NAV_FLAT.some((item) => item.id === readStoredSettingsSection())).toBe(true);
  });

  it("filters nav groups by label, description, and keywords", () => {
    expect(filterSettingsNavGroups("记忆").flatMap((g) => g.items.map((i) => i.id))).toContain("memory");
    expect(filterSettingsNavGroups("truth").flatMap((g) => g.items.map((i) => i.id))).toContain("doctor");
  });

  it("returns first nav match for search jump", () => {
    expect(firstSettingsNavMatch("模型")).toBe("models");
    expect(firstSettingsNavMatch("")).toBe("doctor");
  });
});

import { describe, expect, it } from "vitest";
import {
  filterSettingsNavGroups,
  firstSettingsNavMatch,
  LAWMIND_SETTINGS_DEFAULT_SECTION,
  lawmindSettingsSectionFromDomId,
  readStoredSettingsSection,
  settingsNavGroupsForEdition,
  settingsNavItem,
  SETTINGS_NAV_FLAT,
  SETTINGS_NAV_GROUPS,
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

  it("defaults Day-1 landing to models", () => {
    expect(LAWMIND_SETTINGS_DEFAULT_SECTION).toBe("models");
    expect(SETTINGS_NAV_FLAT.some((item) => item.id === readStoredSettingsSection())).toBe(true);
  });

  it("removes 签批与导出 leaf; review-prefs remains a deep-link section id", () => {
    expect(SETTINGS_NAV_FLAT.some((item) => item.id === "review-prefs")).toBe(false);
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-review-prefs")).toBe("review-prefs");
    expect(SETTINGS_NAV_GROUPS[0]?.items.map((i) => i.id)).toEqual([
      "models",
      "workspace",
      "appearance",
    ]);
  });

  it("orders commercial groups: 工作台 → 知识 → 专业 → 关于", () => {
    expect(SETTINGS_NAV_GROUPS.map((g) => g.id)).toEqual([
      "workspace",
      "knowledge",
      "advanced",
      "about",
    ]);
    expect(SETTINGS_NAV_GROUPS[0]?.items[0]?.id).toBe("models");
    expect(settingsNavItem("doctor")?.label).toBe("系统健康");
  });

  it("filters nav groups by label, description, and keywords", () => {
    expect(filterSettingsNavGroups("记忆").flatMap((g) => g.items.map((i) => i.id))).toContain("memory");
    expect(filterSettingsNavGroups("truth").flatMap((g) => g.items.map((i) => i.id))).toContain("doctor");
  });

  it("returns first nav match for search jump", () => {
    expect(firstSettingsNavMatch("模型")).toBe("models");
    expect(firstSettingsNavMatch("")).toBe("models");
  });

  it("Solo search Enter does not land on hidden roles/collaboration/assistants", () => {
    expect(firstSettingsNavMatch("角色", "solo")).not.toBe("roles");
    expect(firstSettingsNavMatch("协作", "solo")).not.toBe("collaboration");
    expect(firstSettingsNavMatch("编制", "solo")).not.toBe("assistants");
    expect(firstSettingsNavMatch("角色", "firm")).toBe("roles");
    expect(firstSettingsNavMatch("协作", "firm")).toBe("collaboration");
    expect(firstSettingsNavMatch("编制", "firm")).toBe("assistants");
  });

  it("places memory / skills / assistants under 专业控制 (not 知识)", () => {
    const groups = filterSettingsNavGroups("");
    expect(groups.find((g) => g.id === "knowledge")?.items.map((i) => i.id)).toEqual(["templates"]);
    const advancedIds = groups.find((g) => g.id === "advanced")?.items.map((i) => i.id) ?? [];
    expect(advancedIds).toContain("memory");
    expect(advancedIds).toContain("skills");
    expect(advancedIds).toContain("assistants");
    expect(advancedIds).not.toContain("edition");
    expect(groups.find((g) => g.id === "about")?.items.map((i) => i.id)).toContain("edition");
    expect(groups.find((g) => g.id === "knowledge")?.label).toBe("知识");
  });

  it("Solo Day-1 sidebar is models / workspace / appearance / disclaimer", () => {
    const groups = settingsNavGroupsForEdition("solo");
    expect(groups.map((g) => g.id)).toEqual(["workspace", "about", "more"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["models", "workspace", "appearance"]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(["disclaimer"]);
    const moreIds = groups[2]?.items.map((i) => i.id) ?? [];
    expect(moreIds).toContain("doctor");
    expect(moreIds).toContain("automations");
    expect(moreIds).not.toContain("assistants");
    expect(moreIds).not.toContain("roles");
    expect(moreIds).not.toContain("collaboration");
  });

  it("Solo hides roles and collaboration from sidebar groups", () => {
    const soloIds = settingsNavGroupsForEdition("solo")
      .flatMap((g) => g.items.map((i) => i.id));
    expect(soloIds).not.toContain("roles");
    expect(soloIds).not.toContain("collaboration");
    expect(soloIds).not.toContain("assistants");
    expect(soloIds).toContain("doctor");
    const firmIds = settingsNavGroupsForEdition("firm")
      .flatMap((g) => g.items.map((i) => i.id));
    expect(firmIds).toContain("roles");
    expect(firmIds).toContain("collaboration");
  });
});

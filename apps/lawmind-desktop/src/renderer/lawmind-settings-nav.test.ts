/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
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
  SETTINGS_NAV_RETIRED_ITEMS,
} from "./lawmind-settings-nav.js";

describe("lawmind-settings-nav", () => {
  it("maps legacy dom ids to section ids", () => {
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-doctor")).toBe("doctor");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-usage")).toBe("doctor");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-models")).toBe("models");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-memory")).toBe("memory");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-host")).toBe("host");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-assistants")).toBe("assistants");
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

  it("keeps 签批与导出 out of the sidebar; review-prefs remains a deep-link section id", () => {
    expect(SETTINGS_NAV_FLAT.some((item) => item.id === "review-prefs")).toBe(false);
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-review-prefs")).toBe("review-prefs");
    expect(SETTINGS_NAV_GROUPS[0]?.items.map((i) => i.id)).toEqual([
      "models",
      "workspace",
      "host",
      "appearance",
    ]);
  });

  it("orders groups: 本机与外观 → 办案 → 关于 → 专业", () => {
    expect(SETTINGS_NAV_GROUPS.map((g) => g.id)).toEqual(["workspace", "practice", "about", "advanced"]);
    expect(SETTINGS_NAV_GROUPS[0]?.label).toBe("本机与外观");
    expect(SETTINGS_NAV_GROUPS[0]?.items[0]?.id).toBe("models");
    expect(settingsNavItem("doctor")?.label).toBe("系统健康");
    expect(settingsNavItem("tools")?.label).toBe("安全");
    expect(settingsNavItem("assistants")?.label).toBe("助手编制");
    expect(SETTINGS_NAV_GROUPS[1]?.items.map((i) => i.id)).toEqual([
      "automations",
      "templates",
      "memory",
      "assistants",
    ]);
  });

  it("does not put 角色 / 协作 / 技能 / 版本 on the sidebar", () => {
    const sidebarIds = SETTINGS_NAV_FLAT.map((item) => item.id);
    expect(sidebarIds).toContain("assistants");
    expect(sidebarIds).not.toContain("roles");
    expect(sidebarIds).not.toContain("collaboration");
    expect(sidebarIds).not.toContain("skills");
    expect(sidebarIds).not.toContain("edition");
    expect(SETTINGS_NAV_RETIRED_ITEMS.map((item) => item.id)).toEqual([
      "roles",
      "collaboration",
      "skills",
      "edition",
    ]);
  });

  it("filters nav groups by label, description, and keywords", () => {
    expect(filterSettingsNavGroups("记忆").flatMap((g) => g.items.map((i) => i.id))).toContain("memory");
    expect(filterSettingsNavGroups("truth").flatMap((g) => g.items.map((i) => i.id))).toContain("doctor");
  });

  it("returns first nav match for search jump", () => {
    expect(firstSettingsNavMatch("模型")).toBe("models");
    expect(firstSettingsNavMatch("法规库")).toBe("models");
    expect(firstSettingsNavMatch("法宝")).toBe("models");
    expect(firstSettingsNavMatch("本机")).toBe("host");
    expect(firstSettingsNavMatch("")).toBe("models");
    expect(firstSettingsNavMatch("助手")).toBe("assistants");
    expect(firstSettingsNavMatch("编制")).toBe("assistants");
    expect(firstSettingsNavMatch("新建助手")).toBe("assistants");
  });

  it("search never lands on retired 角色 / 协作", () => {
    expect(firstSettingsNavMatch("角色", "solo")).not.toBe("roles");
    expect(firstSettingsNavMatch("协作", "solo")).not.toBe("collaboration");
    expect(firstSettingsNavMatch("角色", "firm")).not.toBe("roles");
    expect(firstSettingsNavMatch("协作", "firm")).not.toBe("collaboration");
  });

  it("Day-1 sidebar is models / workspace / host / appearance / disclaimer", () => {
    const groups = settingsNavGroupsForEdition("solo");
    expect(groups.map((g) => g.id)).toEqual(["workspace", "about", "more"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["models", "workspace", "host", "appearance"]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(["disclaimer"]);
    const moreIds = groups[2]?.items.map((i) => i.id) ?? [];
    expect(moreIds).toContain("doctor");
    expect(moreIds).toContain("automations");
    expect(moreIds).toContain("templates");
    expect(moreIds).toContain("memory");
    expect(moreIds).toContain("assistants");
    expect(moreIds).not.toContain("host");
    expect(moreIds).not.toContain("roles");
    expect(moreIds).not.toContain("collaboration");
    expect(moreIds).not.toContain("skills");
    expect(moreIds).not.toContain("edition");
  });

  it("Firm uses the same lawyer-facing sidebar as Solo", () => {
    const soloIds = settingsNavGroupsForEdition("solo").flatMap((g) => g.items.map((i) => i.id));
    const firmIds = settingsNavGroupsForEdition("firm").flatMap((g) => g.items.map((i) => i.id));
    expect(firmIds).toEqual(soloIds);
    expect(firmIds).not.toContain("roles");
    expect(firmIds).not.toContain("collaboration");
    expect(firmIds).toContain("assistants");
    expect(firmIds).toContain("host");
    expect(firmIds).toContain("doctor");
  });

  it("keeps 助手编制 when reopening settings from lastSection", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    localStorage.setItem("lawmind.settings.lastSection", "assistants");
    expect(readStoredSettingsSection()).toBe("assistants");
    localStorage.setItem("lawmind.settings.lastSection", "roles");
    expect(readStoredSettingsSection()).toBe(LAWMIND_SETTINGS_DEFAULT_SECTION);
  });
});

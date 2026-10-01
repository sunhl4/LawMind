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
  settingsNavItemsForEdition,
  SETTINGS_NAV_FLAT,
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_RETIRED_ITEMS,
} from "./lawmind-settings-nav.js";

describe("lawmind-settings-nav", () => {
  it("maps legacy dom ids to section ids", () => {
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-doctor")).toBe("workspace");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-usage")).toBe("workspace");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-models")).toBe("models");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-memory")).toBe("memory");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-host")).toBe("workspace");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-assistants")).toBe("assistants");
    expect(lawmindSettingsSectionFromDomId("lawmind-settings-app-update")).toBe("account");
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
      "account",
      "models",
      "workspace",
      "appearance",
    ]);
  });

  it("orders groups: 本机与外观 → 办案 → 关于", () => {
    expect(SETTINGS_NAV_GROUPS.map((g) => g.id)).toEqual(["workspace", "practice", "about"]);
    expect(SETTINGS_NAV_GROUPS[0]?.label).toBe("本机与外观");
    expect(SETTINGS_NAV_GROUPS[0]?.items[0]?.id).toBe("account");
    expect(settingsNavItem("account")?.label).toBe("账号");
    expect(settingsNavItem("doctor")?.label).toBe("系统健康");
    expect(SETTINGS_NAV_FLAT.some((item) => item.id === "doctor")).toBe(false);
    expect(SETTINGS_NAV_FLAT.some((item) => item.id === "tools")).toBe(false);
    expect(firstSettingsNavMatch("离线")).toBeUndefined();
    expect(firstSettingsNavMatch("安全")).toBeUndefined();
    expect(firstSettingsNavMatch("沙箱")).toBeUndefined();
    expect(settingsNavItem("assistants")?.label).toBe("助手编制");
    expect(SETTINGS_NAV_GROUPS[1]?.items.map((i) => i.id)).toEqual([
      "collaboration",
      "automations",
      "memory",
    ]);
  });

  it("does not put 角色 / 助手编制 / 技能 / 版本 / 文书模板 on the base sidebar", () => {
    const sidebarIds = SETTINGS_NAV_FLAT.map((item) => item.id);
    expect(sidebarIds).not.toContain("assistants");
    expect(sidebarIds).not.toContain("roles");
    expect(sidebarIds).toContain("collaboration");
    expect(sidebarIds).not.toContain("skills");
    expect(sidebarIds).not.toContain("edition");
    expect(sidebarIds).not.toContain("templates");
    expect(SETTINGS_NAV_RETIRED_ITEMS.map((item) => item.id)).toEqual([
      "assistants",
      "roles",
      "skills",
      "edition",
      "doctor",
      "templates",
    ]);
  });

  it("filters nav groups by label, description, and keywords", () => {
    expect(filterSettingsNavGroups("记忆").flatMap((g) => g.items.map((i) => i.id))).toContain("memory");
    expect(filterSettingsNavGroups("查找").flatMap((g) => g.items.map((i) => i.id))).toContain("workspace");
    expect(filterSettingsNavGroups("体检").flatMap((g) => g.items.map((i) => i.id))).not.toContain("doctor");
  });

  it("returns first nav match for search jump", () => {
    expect(firstSettingsNavMatch("模型")).toBe("models");
    expect(firstSettingsNavMatch("法规库")).toBe("models");
    expect(firstSettingsNavMatch("法宝")).toBe("models");
    expect(firstSettingsNavMatch("本机")).toBe("workspace");
    expect(firstSettingsNavMatch("")).toBe("account");
    expect(firstSettingsNavMatch("账号")).toBe("account");
    expect(firstSettingsNavMatch("订阅")).toBe("account");
    expect(firstSettingsNavMatch("套餐")).toBe("account");
    expect(firstSettingsNavMatch("助手")).toBeUndefined();
    expect(firstSettingsNavMatch("编制")).toBeUndefined();
    expect(firstSettingsNavMatch("新建助手")).toBeUndefined();
    expect(firstSettingsNavMatch("助手", "firm")).toBe("assistants");
    expect(firstSettingsNavMatch("编制", "firm")).toBe("assistants");
  });

  it("search never lands on retired 角色", () => {
    expect(firstSettingsNavMatch("角色", "solo")).not.toBe("roles");
    expect(firstSettingsNavMatch("协作", "solo")).toBe("collaboration");
    expect(firstSettingsNavMatch("角色", "firm")).not.toBe("roles");
    expect(firstSettingsNavMatch("协作", "firm")).toBe("collaboration");
  });

  it("Solo sidebar omits 助手编制; Firm keeps it under 办案", () => {
    const soloIds = settingsNavItemsForEdition("solo").map((item) => item.id);
    expect(soloIds).toEqual([
      "account",
      "models",
      "workspace",
      "appearance",
      "collaboration",
      "automations",
      "memory",
      "disclaimer",
    ]);
    expect(soloIds).not.toContain("assistants");
    expect(settingsNavGroupsForEdition("solo").some((group) => group.id === "more")).toBe(false);
    expect(soloIds).not.toContain("doctor");
    expect(soloIds).not.toContain("tools");
    expect(soloIds).not.toContain("templates");
    expect(soloIds).not.toContain("host");
    expect(soloIds).not.toContain("roles");
    expect(soloIds).toContain("collaboration");
    expect(soloIds).not.toContain("skills");
    expect(soloIds).not.toContain("edition");

    const firmIds = settingsNavItemsForEdition("firm").map((item) => item.id);
    expect(firmIds).toContain("assistants");
    expect(firmIds.filter((id) => id !== "assistants")).toEqual(soloIds);
  });

  it("search never lands on retired 文书模板", () => {
    expect(firstSettingsNavMatch("文书模板")).not.toBe("templates");
    expect(firstSettingsNavMatch("pptx")).not.toBe("templates");
  });

  it("Firm puts 助手编制 on the lawyer-facing sidebar; Solo does not", () => {
    const soloIds = settingsNavItemsForEdition("solo").map((item) => item.id);
    const firmIds = settingsNavItemsForEdition("firm").map((item) => item.id);
    expect(soloIds).not.toContain("assistants");
    expect(firmIds).toContain("assistants");
    expect(firmIds).not.toContain("roles");
    expect(firmIds).toContain("collaboration");
    expect(firmIds).not.toContain("host");
    expect(firmIds).not.toContain("doctor");
  });

  it("keeps 助手编制 deep-link when reopening settings from lastSection", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    localStorage.setItem("lawmind.settings.lastSection", "assistants");
    expect(readStoredSettingsSection()).toBe("assistants");
    localStorage.setItem("lawmind.settings.lastSection", "host");
    expect(readStoredSettingsSection()).toBe("workspace");
    localStorage.setItem("lawmind.settings.lastSection", "roles");
    expect(readStoredSettingsSection()).toBe(LAWMIND_SETTINGS_DEFAULT_SECTION);
    localStorage.setItem("lawmind.settings.lastSection", "tools");
    expect(readStoredSettingsSection()).toBe(LAWMIND_SETTINGS_DEFAULT_SECTION);
    localStorage.setItem("lawmind.settings.lastSection", "templates");
    expect(readStoredSettingsSection()).toBe(LAWMIND_SETTINGS_DEFAULT_SECTION);
    localStorage.setItem("lawmind.settings.lastSection", "app-update");
    expect(readStoredSettingsSection()).toBe("account");
  });
});

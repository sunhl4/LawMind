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
      "assistants",
    ]);
  });

  it("does not put 角色 / 协作 / 技能 / 版本 / 文书模板 on the sidebar", () => {
    const sidebarIds = SETTINGS_NAV_FLAT.map((item) => item.id);
    expect(sidebarIds).toContain("assistants");
    expect(sidebarIds).not.toContain("roles");
    expect(sidebarIds).toContain("collaboration");
    expect(sidebarIds).not.toContain("skills");
    expect(sidebarIds).not.toContain("edition");
    expect(sidebarIds).not.toContain("templates");
    expect(SETTINGS_NAV_RETIRED_ITEMS.map((item) => item.id)).toEqual([
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
    expect(firstSettingsNavMatch("助手")).toBe("assistants");
    expect(firstSettingsNavMatch("编制")).toBe("assistants");
    expect(firstSettingsNavMatch("新建助手")).toBe("assistants");
  });

  it("search never lands on retired 角色", () => {
    expect(firstSettingsNavMatch("角色", "solo")).not.toBe("roles");
    expect(firstSettingsNavMatch("协作", "solo")).toBe("collaboration");
    expect(firstSettingsNavMatch("角色", "firm")).not.toBe("roles");
    expect(firstSettingsNavMatch("协作", "firm")).toBe("collaboration");
  });

  it("sidebar is one flat list of every lawyer-facing section", () => {
    const ids = settingsNavItemsForEdition("solo").map((item) => item.id);
    expect(ids).toEqual([
      "account",
      "models",
      "workspace",
      "appearance",
      "collaboration",
      "automations",
      "memory",
      "assistants",
      "disclaimer",
    ]);
    expect(ids).not.toContain("app-update");
    expect(settingsNavGroupsForEdition("solo").some((group) => group.id === "more")).toBe(false);
    expect(ids).not.toContain("doctor");
    expect(ids).not.toContain("tools");
    expect(ids).not.toContain("templates");
    expect(ids).not.toContain("host");
    expect(ids).not.toContain("roles");
    expect(ids).toContain("collaboration");
    expect(ids).not.toContain("skills");
    expect(ids).not.toContain("edition");
  });

  it("search never lands on retired 文书模板", () => {
    expect(firstSettingsNavMatch("文书模板")).not.toBe("templates");
    expect(firstSettingsNavMatch("pptx")).not.toBe("templates");
  });

  it("Firm uses the same lawyer-facing sidebar as Solo", () => {
    const soloIds = settingsNavItemsForEdition("solo").map((item) => item.id);
    const firmIds = settingsNavItemsForEdition("firm").map((item) => item.id);
    expect(firmIds).toEqual(soloIds);
    expect(firmIds).not.toContain("roles");
    expect(firmIds).toContain("collaboration");
    expect(firmIds).toContain("assistants");
    expect(firmIds).not.toContain("host");
    expect(firmIds).not.toContain("doctor");
  });

  it("keeps 助手编制 when reopening settings from lastSection", () => {
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

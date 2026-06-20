import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openMatterCockpit } from "./e2e-helpers";

test.describe("LawMind dialogs", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("create matter dialog uses wizard backdrop", async ({ page }) => {
    await gotoShell(page);
    await openMatterCockpit(page);
    const createBtn = page.getByRole("button", { name: /新建案件/i }).first();
    await createBtn.click({ timeout: 60_000 });
    const dialog = page.getByRole("dialog", { name: /新建案件|创建案件/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".lm-wizard-backdrop")).toBeVisible();
    await page.getByRole("button", { name: /取消|关闭/i }).first().click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  });

  test("first-run wizard can be dismissed without blocking shell", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("lm.firstRun.dismissed");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 60_000 });
    const firstRun = page.getByRole("dialog", { name: /LawMind 新手引导|LawMind 首次配置|API/i });
    if (await firstRun.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await firstRun.getByRole("button", { name: /稍后再说|不用了|跳过|关闭/i }).first().click({ force: true });
      await expect(firstRun).toBeHidden({ timeout: 15_000 });
    }
    await expect(page.getByRole("navigation", { name: "功能模块" })).toBeVisible();
  });
});

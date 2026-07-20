import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("LawMind dialogs", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("新建案件 creates a folder inline under 案件材料 (no create dialog)", async ({ page }) => {
    await gotoShell(page);
    const casesHeader = page
      .locator(".lm-fs-section")
      .filter({ hasText: "案件材料" })
      .locator(".lm-fs-dual-header-body");
    await expect(casesHeader).toBeVisible({ timeout: 30_000 });
    await casesHeader.click({ button: "right" });
    const newMatter = page.getByRole("menuitem", { name: /新建案件/ });
    await expect(newMatter).toBeVisible({ timeout: 15_000 });
    await newMatter.click();
    const inline = page.locator(".lm-fs-inline-input input").first();
    await expect(inline).toBeVisible({ timeout: 15_000 });
    await expect(inline).toHaveAttribute("placeholder", /案件名/);
    // Cancel without creating — Esc closes the inline field.
    await inline.press("Escape");
    await expect(page.getByRole("dialog", { name: /新建案件|创建案件/i })).toHaveCount(0);
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

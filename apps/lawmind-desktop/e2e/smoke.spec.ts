import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("LawMind renderer smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("loads shell with LawMind brand", async ({ page }) => {
    await gotoShell(page);
    await expect(page).toHaveTitle(/LawMind/);
    await expect(page.getByLabel("功能模块")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("LawMind").first()).toBeVisible();
    await expect(page.getByText("法律工作台").first()).toBeVisible();
  });

  test("shows header settings and layout toolbar", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByRole("main").getByRole("button", { name: "设置" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("main").getByRole("toolbar", { name: "面板布局" })).toBeVisible();
  });

  test("hides readiness strip when health reports model configured", async ({ page }) => {
    await gotoShell(page);
    await expect(page.locator(".lm-readiness-strip")).toHaveCount(0, { timeout: 60_000 });
  });
});

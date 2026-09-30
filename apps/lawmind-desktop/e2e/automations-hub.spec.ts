import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("自动办件 / 工作台", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("automations opens from settings", async ({ page }) => {
    await gotoShell(page);
    await page.getByRole("complementary").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "设置" })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "搜索设置项" });
    await search.fill("自动办件");
    await search.press("Enter");
    await expect(page.getByTestId("lm-automations-panel")).toBeVisible({ timeout: 30_000 });
  });

  test("待发出不走在办，顶栏打开的是工作台", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByTestId("lm-side-needs-decision")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /待我拍板/i })).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "功能模块" });
    await nav.getByTestId("lm-tab-desk").click();
    await expect(page.getByTestId("lm-lawyer-workbench")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-agents-desk")).toHaveCount(0);
  });

  test("pending decisions do not surface as sidebar 待我拍板", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByTestId("lm-side-needs-decision")).toHaveCount(0);
    await expect(page.locator(".lm-requires-action-strip")).toHaveCount(0);
  });
});

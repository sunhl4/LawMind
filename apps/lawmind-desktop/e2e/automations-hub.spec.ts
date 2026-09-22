import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("自动办件 / 待我拍板 / 在办委派", () => {
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

  test("待我拍板 opens 在办 desk with decision focus (no Action Hub modal)", async ({ page }) => {
    await gotoShell(page);
    const hubTrigger = page
      .getByTestId("lm-side-needs-decision")
      .or(page.getByTestId("lm-side-action-hub"))
      .first();
    await expect(hubTrigger).toBeVisible({ timeout: 60_000 });
    await hubTrigger.click();
    await expect(page.getByRole("dialog", { name: /待我拍板/i })).toHaveCount(0);
    await expect(page.getByTestId("lm-agents-desk")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-agent-fleet-panel")).toHaveAttribute(
      "data-needs-decision",
      "true",
      { timeout: 15_000 },
    );
  });

  test("在办 desk opens from top nav", async ({ page }) => {
    await gotoShell(page);
    const nav = page.getByRole("navigation", { name: "功能模块" });
    await nav.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agents-desk")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("pending decisions surface as sidebar 待我拍板 (not compose strip)", async ({ page }) => {
    await gotoShell(page);
    // Mock action-summary already returns pending items; sole chrome entry is sidebar.
    const hub = page.getByTestId("lm-side-needs-decision").or(page.getByTestId("lm-side-action-hub"));
    await expect(hub).toBeVisible({ timeout: 45_000 });
    await expect(hub).toContainText("待我拍板");
    await expect(page.locator(".lm-requires-action-strip")).toHaveCount(0);
  });
});

import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("自动办件 / 待我拍板 / 在办委派", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("automations opens from 更多 menu", async ({ page }) => {
    await gotoShell(page);
    const nav = page.getByRole("navigation", { name: "功能模块" });
    await nav.getByTestId("lm-nav-more").click();
    await nav.getByTestId("lm-tab-automations").click();
    await expect(page.getByTestId("lm-automations-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /自动办件/ })).toBeVisible();
  });

  test("待我拍板 opens 在办 desk with decision focus (no Action Hub modal)", async ({ page }) => {
    await gotoShell(page);
    const hubTrigger = page
      .getByTestId("lm-side-needs-decision").or(page.getByTestId("lm-side-action-hub"))
      .or(page.locator(".lm-needs-decision-trigger"))
      .or(page.locator(".lm-action-hub-trigger"))
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

  test("在办 → 交出去的活 is reachable from spawn 更多", async ({ page }) => {
    await gotoShell(page);
    const nav = page.getByRole("navigation", { name: "功能模块" });
    await nav.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agents-desk")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("lm-fleet-spawn-plus").click();
    await page.getByTestId("lm-fleet-spawn-collaboration").click();
    await expect(page.getByRole("heading", { name: "交出去的", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("lm-agents-tab-active")).toBeVisible();
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

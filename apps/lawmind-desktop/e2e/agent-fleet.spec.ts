import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("Agent fleet 在办", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("header tab opens fleet panel", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByLabel("功能模块")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-spawn")).toBeVisible({ timeout: 30_000 });
  });

  test("selects pending review run and shows detail actions", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByLabel("功能模块")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-agent-fleet-card-pending_review")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("lm-agent-fleet-card-pending_review").click();
    const detail = page.getByLabel("详情与待办");
    await expect(detail.getByRole("button", { name: "进入文书台", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const actionsTab = detail.getByRole("tab", { name: /待办/ });
    await expect(actionsTab).toHaveAttribute("aria-selected", "true");
    await expect(actionsTab).toHaveAttribute("aria-controls", "lm-fleet-panel-actions");
    await expect(detail.locator("#lm-fleet-panel-actions")).toBeVisible();
  });
});

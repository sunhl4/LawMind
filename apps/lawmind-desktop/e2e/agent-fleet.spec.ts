import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("在办工作台", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("opens rebuilt workbench", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByLabel("功能模块")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "在办", exact: true })).toBeVisible();
  });

  test("pending review shows primary action", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-fleet-primary-review")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-fleet-primary-review")).toContainText(/签批|文书台/);
  });
});

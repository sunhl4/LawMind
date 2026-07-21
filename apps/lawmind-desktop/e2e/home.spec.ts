import { expect, test } from "@playwright/test";
import { E2E_FIRST_RUN_DISMISS_KEY, gotoShell } from "./e2e-helpers";

test.describe("Solo Home cockpit (Skills E11)", () => {
  test("default mainView is Home when classic preference off", async ({ page }) => {
    await page.addInitScript((firstRunKey) => {
      localStorage.setItem(firstRunKey, "1");
      localStorage.setItem("lawmind.ui.sidebarCollapsed", "0");
      localStorage.setItem("lm.preferClassicChatHome", "0");
      localStorage.setItem("lm.homeMigrationBanner.dismissed", "1");
    }, E2E_FIRST_RUN_DISMISS_KEY);
    await gotoShell(page);
    await expect(page.getByTestId("lm-tab-home")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("lm-home-view")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("lm-home-open-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("classic preference opens workspace chat", async ({ page }) => {
    await page.addInitScript((firstRunKey) => {
      localStorage.setItem(firstRunKey, "1");
      localStorage.setItem("lm.preferClassicChatHome", "1");
    }, E2E_FIRST_RUN_DISMISS_KEY);
    await gotoShell(page);
    await expect(page.getByTestId("lm-tab-workspace")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("lm-home-view")).toHaveCount(0);
  });
});

import { expect, test } from "@playwright/test";
import { e2eMockApiBase, gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("顶栏不再有在办", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
    await page.request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });

  test("对话和工作台在，在办不在", async ({ page }) => {
    await gotoShell(page);
    const nav = page.getByLabel("功能模块");
    await expect(nav.getByTestId("lm-tab-workspace")).toBeVisible({ timeout: 60_000 });
    await expect(nav.getByTestId("lm-tab-desk")).toBeVisible();
    await expect(nav.getByTestId("lm-tab-agents")).toHaveCount(0);
    await page.getByTestId("lm-tab-desk").click();
    await expect(page.getByTestId("lm-lawyer-workbench")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".lm-review-workbench")).toHaveCount(0);
  });
});

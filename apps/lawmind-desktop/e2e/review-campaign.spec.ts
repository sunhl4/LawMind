import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openReviewWorkbench } from "./e2e-helpers";

test.describe("审查专案组 (Skills E2)", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("文书台跑专案组可见风险分与角色 Tab", async ({ page }) => {
    await gotoShell(page);
    await openReviewWorkbench(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });

    const panel = page.getByTestId("lm-review-campaign");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByTestId("lm-review-campaign-run").click();
    await expect(page.getByTestId("lm-safety-score")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-review-campaign-roles")).toBeVisible();
    const tabs = page.getByTestId("lm-review-campaign-roles").getByRole("tab");
    await expect(tabs).toHaveCount(5, { timeout: 10_000 });
    await panel.getByTestId("lm-review-campaign-report-btn").click();
    await expect(page.getByTestId("lm-review-campaign-report")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("lm-review-campaign-download")).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("会议室冒烟", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("顶栏会议室可达，设置区与议题可见", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-meeting").click();
    await expect(page.getByRole("heading", { name: /会议室|讨论/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    // 参会 / 议题等设置区（空态也可能显示加载助手）
    const setup = page
      .locator(".lm-matter-meeting-setup, [data-testid='lm-matter-meeting'], .lm-matter-meeting")
      .first();
    await expect(setup).toBeVisible({ timeout: 30_000 });
  });
});

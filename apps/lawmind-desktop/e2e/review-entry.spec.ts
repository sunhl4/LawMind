import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openReviewWorkbench } from "./e2e-helpers";

test.describe("文书台 / 待我拍板 决策落地", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("在办 pending_review → 进入文书台可见改稿面", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    const team = page.getByTestId("lm-fleet-team-default");
    if (await team.isVisible().catch(() => false)) {
      await team.click();
    } else {
      const card = page.getByTestId("lm-agent-fleet-card-pending_review");
      if (await card.isVisible().catch(() => false)) {
        await card.click();
      }
    }
    await expect(page.getByTestId("lm-fleet-draft-approve")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-fleet-draft-hint")).toBeVisible();
    await expect(page.getByTestId("lm-fleet-primary-review")).toContainText(/文书台/);
    await page.getByTestId("lm-fleet-primary-review").click();
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator(".lm-review-compose-main, .lm-review-editor-pane, .lm-review-preview-pane").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /回到在办签批/ }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("侧栏待我拍板 opens needs-decision focus", async ({ page }) => {
    await gotoShell(page);
    const hub = page.getByTestId("lm-side-needs-decision").or(page.getByTestId("lm-side-action-hub"));
    await expect(hub).toBeVisible({ timeout: 60_000 });
    await hub.click();
    await expect(page.getByTestId("lm-agents-desk")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-agent-fleet-panel")).toHaveAttribute(
      "data-needs-decision",
      "true",
      { timeout: 15_000 },
    );
    await expect(
      page.getByTestId("lm-fleet-decision-focus-lead").or(page.getByTestId("lm-fleet-decision-empty")),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("openReviewWorkbench helper still reaches workbench", async ({ page }) => {
    await gotoShell(page);
    await openReviewWorkbench(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("顶栏文书台 peer tab opens review workbench", async ({ page }) => {
    await gotoShell(page);
    const tab = page.getByTestId("lm-tab-review");
    await expect(tab).toBeVisible({ timeout: 30_000 });
    await tab.click();
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(tab).toHaveAttribute("aria-current", "page");
  });
});

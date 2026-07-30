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
    // 团队视图：点助手自动选中其首条待办
    await page.getByTestId("lm-fleet-team-default").click();
    await expect(page.getByTestId("lm-fleet-primary-review")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-fleet-primary-review")).toContainText(/签批|文书台/);
    await expect(page.getByTestId("lm-fleet-campaign-review")).toBeVisible();
    await expect(page.getByTestId("lm-fleet-campaign-review")).toContainText("用审查专案组");
  });

  test("team mode lists assistants and queue filter still works", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-fleet-mode-team")).toBeVisible();
    await page.getByTestId("lm-fleet-mode-team").click();
    await expect(page.getByTestId("lm-fleet-team-all")).toBeVisible();
    await expect(page.getByTestId("lm-fleet-pending-teach")).toContainText("待教");
    await page.getByTestId("lm-fleet-team-default").click();
    await expect(page.getByTestId("lm-fleet-primary-review")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("lm-fleet-mode-queue").click();
    await expect(page.getByTestId("lm-fleet-group-toggle-review")).toBeVisible();
  });

  test("desk sections: 待拍板 / 交出去的活 / 按流程办", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agents-desk-chrome")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "在办", exact: true })).toBeVisible();
    await expect(page.getByTestId("lm-agents-tab-active")).toHaveAttribute("aria-current", "page");

    await page.getByTestId("lm-agents-tab-delegations").click();
    await expect(page.getByTestId("lm-agents-tab-delegations")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("lm-agents-desk-chrome")).toContainText("交出去的活");

    await page.getByTestId("lm-agents-tab-workflows").click();
    await expect(page.getByTestId("lm-agents-tab-workflows")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("lm-agents-desk-chrome")).toContainText("按流程办");

    await page.getByTestId("lm-agents-tab-active").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("必核勾选 → 通过 → 导出 Word 引导条", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("lm-fleet-team-default").click();
    await expect(page.getByTestId("lm-fleet-desk-checklist")).toBeVisible({ timeout: 15_000 });
    const checkAll = page.getByTestId("lm-fleet-checklist-check-all");
    if (await checkAll.isEnabled()) {
      await checkAll.click();
    }
    await expect(page.getByTestId("lm-fleet-draft-approve")).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId("lm-fleet-draft-approve").click();
    await expect(page.getByTestId("lm-fleet-post-approve")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-fleet-post-approve")).toContainText(/已通过/);
    await page.getByTestId("lm-fleet-post-approve-export").click();
    await expect(page.getByTestId("lm-fleet-post-approve")).toContainText(/已导出|e2e\.docx/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("lm-fleet-post-approve-dismiss")).toBeVisible();
  });
});

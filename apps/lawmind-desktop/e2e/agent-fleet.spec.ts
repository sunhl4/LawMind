import { expect, test } from "@playwright/test";
import { e2eMockApiBase, gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("在办工作台", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
    await page.request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });

  test("opens rebuilt workbench", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByLabel("功能模块")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "在办", exact: true })).toBeVisible();
    await expect(page.getByTestId("lm-fleet-pick-hint")).toHaveCount(0);
  });

  test("outbound send shows approve-send action", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("lm-fleet-team-default").click();
    await expect(page.getByTestId("lm-ceremony-primary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-ceremony-primary")).toContainText(/批准发送/);
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
    await expect(page.getByTestId("lm-ceremony-primary")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("lm-fleet-mode-queue").click();
    await expect(page.getByTestId("lm-fleet-group-toggle-approve")).toBeVisible();
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
    await expect(page.getByTestId("lm-agents-open-meeting")).toHaveCount(0);
    await expect(page.getByTestId("lm-agents-open-automations")).toHaveCount(0);
  });

  test("在办条可进改稿，待拍板不出现内部审稿", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-agents-open-review")).toBeVisible();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toContainText("E2E 待发信");
    await expect(page.getByTestId("lm-agent-fleet-panel")).not.toContainText("E2E 待签批草稿");
  });
});

import { expect, test } from "@playwright/test";
import { e2eMockApiBase, gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("在办工作台", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
    await page.request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });

  test("opens the docket with the item that needs the lawyer", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByLabel("功能模块")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "在办", exact: true })).toBeVisible();
    await expect(page.getByTestId("lm-fleet-band-needsYou")).toBeVisible();
    await expect(page.getByTestId("lm-fleet-band-needsYou")).toContainText("停在你这里");
    await expect(page.getByTestId("lm-fleet-brief")).toContainText("发出前要你看过");
    await expect(page.getByTestId("lm-ceremony-primary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-ceremony-primary")).toContainText(/批准发送/);
    await expect(page.getByTestId("lm-fleet-pick-hint")).toHaveCount(0);
  });

  test("更多仍可进入交出去的活和按流程办", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agents-desk-chrome")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("lm-agents-desk-more").locator("summary").click();
    await page.getByTestId("lm-agents-tab-delegations").click();
    await expect(page.getByTestId("lm-agents-desk-chrome")).toContainText("交出去的活");

    await page.getByTestId("lm-agents-desk-more").locator("summary").click();
    await page.getByTestId("lm-agents-tab-workflows").click();
    await expect(page.getByTestId("lm-agents-desk-chrome")).toContainText("按流程办");

    await page.getByTestId("lm-agents-tab-active").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-agents-open-meeting")).toHaveCount(0);
    await expect(page.getByTestId("lm-agents-open-automations")).toHaveCount(0);
  });

  test("在办条可进改稿，内部审稿不出现在交办册", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-agents-open-review")).toBeVisible();
    await expect(page.getByTestId("lm-agent-fleet-panel")).toContainText("E2E 待发信");
    await expect(page.getByTestId("lm-agent-fleet-panel")).not.toContainText("E2E 待签批草稿");
  });
});

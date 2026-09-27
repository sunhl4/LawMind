import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openComposeOptions } from "./e2e-helpers";

test.describe("会议室已退出主路径", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("输入选项里没有会议室，也不能再开始轮流讨论", async ({ page }) => {
    await gotoShell(page);
    await openComposeOptions(page);
    await expect(page.getByTestId("lm-compose-open-meeting")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "开始讨论", exact: true })).toHaveCount(0);
  });
});

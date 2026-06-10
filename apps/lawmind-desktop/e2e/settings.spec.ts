import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("LawMind settings page", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("opens settings, navigates via search, shows section, returns", async ({ page }) => {
    await gotoShell(page);

    await page.getByRole("main").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "设置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "搜索设置项" });
    await search.fill("模型");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "模型与检索", level: 2 })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "← 返回" }).click();
    await expect(page.getByRole("region", { name: "设置" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("main").getByRole("button", { name: "设置" })).toBeVisible();
  });
});

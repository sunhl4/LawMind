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
    await expect(page.locator(".lm-main-header-settings")).toBeVisible();
    await expect(page.getByRole("heading", { name: "开始使用", level: 2 })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "搜索设置项" });
    await search.fill("外观");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "外观", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel("界面字号").selectOption("comfortable");
    await expect(page.locator("html[data-lm-font-scale='comfortable']")).toHaveCount(1);

    await search.fill("模型");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "模型/API", level: 2 })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "关闭设置并返回" }).click();
    await expect(page.getByRole("region", { name: "设置" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("main").getByRole("button", { name: "设置" })).toBeVisible();

    await page.getByRole("main").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "设置" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "设置" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("main").getByRole("button", { name: "设置" })).toBeVisible();
  });
});

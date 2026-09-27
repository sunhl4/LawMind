import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("LawMind settings page", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("opens settings, navigates via search, shows section, returns", async ({ page }) => {
    await gotoShell(page);

    await expect(page.getByTestId("lm-tab-workspace")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("lm-header-new-assistant")).toHaveCount(0);

    await page.getByRole("complementary").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "设置" })).toBeVisible();
    await expect(page.locator(".lm-main-header-settings")).toBeVisible();
    await expect(page.getByRole("heading", { name: "模型与连接", level: 2 })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "搜索设置项" });
    await search.fill("外观");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "外观", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("radiogroup", { name: "界面字号" }).getByRole("radio", { name: "大一点" }).click();
    await expect(page.locator("html[data-lm-font-scale='large']")).toHaveCount(1);

    await search.fill("模型");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "模型与连接", level: 2 })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByRole("heading", { name: "系统健康", level: 2 })).toHaveCount(0);

    await search.fill("扫描");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "工作区", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("lm-archive-organize-entry")).toBeVisible();
    await page.getByTestId("lm-archive-organize-open").click();
    await expect(page.getByTestId("lm-archive-organize")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "整理电脑上的资料", level: 1 })).toBeVisible();
    await page.getByTestId("lm-archive-organize-back").click();
    await expect(page.getByRole("heading", { name: "工作区", level: 2 })).toBeVisible({
      timeout: 15_000,
    });

    await search.fill("本机");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "工作区", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("lm-host-folders")).toBeVisible();

    await search.fill("助手编制");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "助手编制", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("lm-settings-assistants")).toBeVisible();
    await expect(page.getByTestId("lm-assistants-quick-create")).toBeVisible();
    await expect(page.getByTestId("lm-settings-nav-assistants")).toBeVisible();

    await expect(page.getByTestId("lm-settings-nav-roles")).toHaveCount(0);
    await expect(page.getByTestId("lm-settings-nav-collaboration")).toHaveCount(0);
    await expect(page.getByTestId("lm-settings-nav-skills")).toHaveCount(0);
    await expect(page.getByTestId("lm-settings-nav-edition")).toHaveCount(0);

    await page.getByRole("button", { name: "关闭设置并返回" }).first().click();
    await expect(page.getByRole("region", { name: "设置" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "设置" })).toHaveCount(1);
    await expect(page.getByRole("complementary").getByRole("button", { name: "设置" })).toBeVisible();

    await page.getByRole("complementary").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "设置" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "设置" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "设置" })).toHaveCount(1);
  });
});

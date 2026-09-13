import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("LawMind settings page", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("opens settings, navigates via search, shows section, returns", async ({ page }) => {
    await gotoShell(page);

    await expect(page.getByTestId("lm-header-new-assistant")).toBeVisible({ timeout: 60_000 });

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
    await page.getByLabel("界面字号").selectOption("comfortable");
    await expect(page.locator("html[data-lm-font-scale='comfortable']")).toHaveCount(1);

    await search.fill("模型");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "模型与连接", level: 2 })).toBeVisible({
      timeout: 15_000,
    });

    await search.fill("内测");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "系统健康", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    const doctorAdmin = page.getByTestId("lm-doctor-admin");
    if ((await doctorAdmin.getAttribute("open")) === null) {
      await doctorAdmin.locator("summary").first().click();
    }
    const teamGrowth = page.getByTestId("lm-doctor-team-growth");
    await expect(teamGrowth).toBeVisible({ timeout: 15_000 });
    await expect(teamGrowth).toContainText("团队成长 · 内测指标");
    await expect(teamGrowth).toContainText("主力一次过率");
    await expect(page.getByTestId("lm-doctor-team-growth-baseline")).toBeVisible();
    await expect(page.getByTestId("lm-doctor-north-star")).toBeVisible();
    await expect(page.getByTestId("lm-doctor-north-star")).toContainText("交付北极星");

    await search.fill("扫描");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "工作区", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("lm-historical-scan")).toBeVisible();
    await expect(page.getByTestId("lm-historical-scan")).toContainText("扫描历史材料");

    await search.fill("本机");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "本机能力", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("lm-host-access")).toBeVisible();

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

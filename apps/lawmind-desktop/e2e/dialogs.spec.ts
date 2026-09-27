import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("LawMind dialogs", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("新建案件 opens the create dialog from the sidebar", async ({
    page,
  }) => {
    await gotoShell(page);
    // 对话侧栏把「新建案件」放在「当前案件」菜单里；无会话列表时按钮直接在案件列表上。
    const scopeSwitcher = page.getByTestId("lm-chat-scope-switcher");
    if (await scopeSwitcher.isVisible().catch(() => false)) {
      await scopeSwitcher.click();
    }
    const createBtn = page.getByTestId("lm-matter-sidebar-create");
    await expect(createBtn).toBeVisible({ timeout: 30_000 });
    await createBtn.click();
    const dialog = page.getByRole("dialog", { name: /新建案件|创建案件/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".lm-wizard-backdrop")).toBeVisible();
    await page.getByRole("button", { name: /取消|关闭/i }).first().click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  });

  test("first-run wizard can be dismissed without blocking shell", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("lm.firstRun.dismissed");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 60_000 });
    const firstRun = page.getByRole("dialog", { name: /LawMind 新手引导|LawMind 首次配置|API/i });
    if (await firstRun.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await firstRun.getByRole("button", { name: /稍后再说|不用了|跳过|关闭/i }).first().click({ force: true });
      await expect(firstRun).toBeHidden({ timeout: 15_000 });
    }
    await expect(page.getByRole("navigation", { name: "功能模块" })).toBeVisible();
  });
});

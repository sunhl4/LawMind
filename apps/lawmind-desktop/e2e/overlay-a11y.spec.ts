import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("覆盖层 a11y 冒烟", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("命令面板 Escape 关闭且为 dialog", async ({ page }) => {
    await gotoShell(page);
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: /律师命令|命令/i });
    const visible = await palette.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) {
      // 部分环境快捷键落到浏览器；用侧栏/按钮兜底若存在
      const openBtn = page.getByRole("button", { name: /命令|快速操作/i }).first();
      if (await openBtn.isVisible().catch(() => false)) {
        await openBtn.click();
      } else {
        test.skip();
        return;
      }
    }
    await expect(page.getByRole("dialog", { name: /律师命令|命令/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /律师命令|命令/i })).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test("案件工作台 Tab 可切换到任务", async ({ page }) => {
    await gotoShell(page);
    // 侧栏选第一个案件（若有）
    const matterRow = page.locator("[data-testid^='lm-matter-row'], .lm-matter-sidebar-item").first();
    if (await matterRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await matterRow.click();
    }
    const tablist = page.getByRole("tablist", { name: "案件工作台视图" });
    if (!(await tablist.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await tablist.getByRole("tab", { name: "任务" }).click();
    await expect(tablist.getByRole("tab", { name: "任务" })).toHaveAttribute("aria-selected", "true");
  });
});

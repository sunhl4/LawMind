import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openWorkspaceChat } from "./e2e-helpers";

/**
 * 材料树 / 文件台冒烟。浏览器 mock 无 FS bridge 时材料树可能不渲染——此时 skip，
 * Electron 路径见 electron-golden-path.spec.ts。
 */
test.describe("文件台 / 材料树冒烟", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("对话页左栏可见案件材料区或本机文件夹区", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);

    const explorer = page
      .locator(
        ".lm-files-explorer, .lm-side-explorer-host .lm-files-explorer, [data-testid='lm-fs-local-folder-section']",
      )
      .first();
    const hasExplorer = await explorer.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!hasExplorer) {
      test.skip(true, "filesystem bridge unavailable in browser E2E");
      return;
    }

    await expect(explorer).toBeVisible();
    // 案件材料区标题或工作区分区
    const casesOrWork = page.getByText(/案件材料|工作区|选择本机文件夹/i).first();
    await expect(casesOrWork).toBeVisible({ timeout: 15_000 });
  });

  test("快捷打开触发器可点（有材料树时）", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const quickOpen = page.getByRole("button", { name: /在材料中搜索/i });
    if (!(await quickOpen.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, "filesystem bridge unavailable in browser E2E");
      return;
    }
    await quickOpen.click();
    const dialog = page.getByRole("dialog", { name: /快速打开/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  });
});

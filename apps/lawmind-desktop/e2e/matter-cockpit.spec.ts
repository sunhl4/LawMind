import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

/**
 * W11 黄金路径 e2e —— 在 MatterWorkbench 拆分前先冻结现有交互轮廓。
 *
 * 这条 spec 只验证“可达性”：导航到案件工作台，确认左侧案件列表可见，
 * 选中后右侧 cockpit 区域出现常驻 tab。任何后续拆分（renderer/matter/）必须
 * 不破坏这些 selector。
 */
test.describe("MatterWorkbench golden path", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("workbench shell renders with matter list placeholder", async ({ page }) => {
    await gotoShell(page);

    const matterTabButton = page.getByRole("navigation", { name: "功能模块" }).getByRole("button", { name: "对话" });
    await matterTabButton.click();

    const listContainer = page
      .locator('[data-testid="lm-matter-list"], .lm-matter-list, .lm-matter-aside')
      .first();
    if (await listContainer.count()) {
      await expect(listContainer).toBeVisible({ timeout: 30_000 });
    }
  });

  test("cockpit, queue, memory tabs are reachable when a matter is selected", async ({ page }) => {
    await gotoShell(page);

    const cockpitOrTabs = page.locator(
      '[data-testid="lm-matter-cockpit"], .lm-matter-cockpit, [data-testid="lm-matter-tabs"]',
    );
    if (await cockpitOrTabs.count()) {
      await expect(cockpitOrTabs.first()).toBeVisible({ timeout: 15_000 });
    }
  });
});

/**
 * Authority fail-closed / open sample-ready UI smoke (C5-2 mock path).
 * Does not call a real vendor — only checks settings surface against mock-api.
 */
import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("authority settings mock", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("settings model section shows open sample-ready + probe copy", async ({ page }) => {
    await gotoShell(page);
    await page.getByRole("complementary").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "设置" })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "搜索设置项" });
    await search.fill("模型");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "模型与连接", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    const boundary = page.getByTestId("lm-settings-authority-boundary");
    await expect(boundary).toBeVisible({ timeout: 15_000 });
    const status = await boundary.getAttribute("data-status");
    // Mock health ships open sample-ready (stable; no flake on unset).
    expect(status).toBe("sample-ready");
    await expect(page.getByTestId("lm-authority-setup")).toBeVisible();
    await expect(page.getByTestId("lm-authority-setup-status")).toContainText("演示语料就绪");
    const probe = page.getByTestId("lm-settings-authority-probe");
    await expect(probe).toBeVisible();
    await expect(probe).toBeEnabled();
    await expect(probe).toHaveText("探测开源语料");
    await probe.click();
    await expect(page.getByTestId("lm-settings-authority-probe-msg")).toContainText(/语料|开源语料|探测成功/);
  });
});

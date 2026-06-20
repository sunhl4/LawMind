import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openWorkspaceChat } from "./e2e-helpers";

test.describe("LawMind workspace chat", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("initial workspace shows scenario cards, compose toolbar, and model picker", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByText("开始对话")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".lm-scenario-card").first()).toBeVisible();
    await expect(page.locator(".lm-compose-toolbar, .lm-compose-box").first()).toBeVisible();
    await expect(page.getByLabel("选择模型").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("compose send control is reachable with mock API", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const composer = page.getByPlaceholder(/输入|消息|交办/i).first();
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.fill("E2E smoke message");
    await expect(page.getByRole("button", { name: /发送|交办/i }).first()).toBeEnabled();
  });
});

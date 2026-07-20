import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openWorkspaceChat } from "./e2e-helpers";

test.describe("LawMind workspace chat", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("initial workspace shows scenario cards, compose toolbar, and model picker", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByRole("region", { name: "对话消息" })).toBeVisible({ timeout: 30_000 });
    // Mock may seed an awaiting-approval session (no empty-state hero).
    const emptyHero = page.getByText("开始对话");
    const seededTurn = page.getByText(/需要您确认|待批准|工作流待确认/);
    await expect(emptyHero.or(seededTurn).first()).toBeVisible({ timeout: 15_000 });
    if (await emptyHero.isVisible().catch(() => false)) {
      await expect(page.locator(".lm-scenario-card").first()).toBeVisible();
    }
    await expect(page.locator(".lm-compose-toolbar, .lm-compose-box").first()).toBeVisible();
    await expect(page.locator(".lm-model-picker-trigger")).toBeVisible({ timeout: 15_000 });
  });

  test("compose send control is reachable with mock API", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const composer = page.getByRole("textbox", { name: "消息输入" });
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.fill("E2E smoke message");
    await expect(page.getByRole("button", { name: /发送|交办/i }).first()).toBeEnabled();
  });
});

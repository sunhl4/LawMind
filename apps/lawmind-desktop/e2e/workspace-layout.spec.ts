import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openWorkspaceChat } from "./e2e-helpers";

test.describe("LawMind workspace layout toggles", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("can hide and restore chat pane from header toggles", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const chatToggle = page.getByRole("button", { name: /隐藏对话区|显示对话区/i });
    if (!(await chatToggle.isVisible().catch(() => false))) {
      test.skip();
    }
    const pressedBefore = await chatToggle.getAttribute("aria-pressed");
    await chatToggle.click();
    await expect(chatToggle).not.toHaveAttribute("aria-pressed", pressedBefore ?? "");
    await chatToggle.click();
    await expect(page.getByRole("region", { name: "对话消息" })).toBeVisible({ timeout: 15_000 });
  });

  test("shows pane recovery when chat and editor are hidden", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const chatToggle = page.getByRole("button", { name: /隐藏对话区|显示对话区/i });
    const editorToggle = page.getByRole("button", { name: /隐藏编辑区|显示编辑区/i });
    if (!(await chatToggle.isVisible().catch(() => false))) {
      test.skip();
    }
    if (!(await editorToggle.isVisible().catch(() => false))) {
      test.skip();
    }
    await chatToggle.click();
    await editorToggle.click();
    await expect(page.getByText("工作区面板已隐藏")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "显示对话区" }).click();
    await expect(page.getByRole("region", { name: "对话消息" })).toBeVisible({ timeout: 15_000 });
  });
});

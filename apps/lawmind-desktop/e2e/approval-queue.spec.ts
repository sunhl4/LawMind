import { expect, test } from "@playwright/test";
import {
  approveToolViaDialog,
  gotoShell,
  installE2eBrowserPrefs,
  openWorkspaceChat,
} from "./e2e-helpers";

/**
 * Approval queue golden path: tool approval card + resume (mock API).
 */
test.describe("LawMind approval queue", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("tool approval card resumes without manual __approved JSON", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByRole("button", { name: /批准并继续/ })).toBeVisible({ timeout: 15_000 });
    const resumeRes = await approveToolViaDialog(page);
    const resumeJson = (await resumeRes.json()) as { resumeEcho?: { decision?: string } };
    expect(resumeJson.resumeEcho?.decision).toBe("approve");
    await expect(page.getByText(/已按您的确认继续/)).toBeVisible({ timeout: 15_000 });
  });

  test("strict permission mode blocks dangerous tools until lawyer approves", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const perm = page.getByLabel("工具权限模式");
    await perm.selectOption("strict");
    await expect(perm).toHaveValue("strict");
    await expect(page.getByRole("button", { name: /批准并继续/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});

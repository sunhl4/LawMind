import { expect, test } from "@playwright/test";
import {
  approveToolViaDialog,
  e2eMockApiBase,
  gotoShell,
  installE2eBrowserPrefs,
  openComposeOptions,
  openWorkspaceChat,
  rejectToolViaCard,
} from "./e2e-helpers";

/**
 * Approval queue golden path: tool approval card + resume (mock API).
 */
test.describe("LawMind approval queue", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
    await page.request.post(`${e2eMockApiBase()}/__e2e__/reset`);
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
    await openComposeOptions(page);
    const perm = page.getByLabel("工具权限模式", { exact: true });
    await perm.selectOption("strict");
    await expect(perm).toHaveValue("strict");
    await expect(page.getByRole("button", { name: /批准并继续/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("reject tool resumes session without requiring another approval dialog", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByRole("button", { name: /暂不办理/ })).toBeVisible({ timeout: 15_000 });
    const resumeRes = await rejectToolViaCard(page);
    const resumeJson = (await resumeRes.json()) as { resumeEcho?: { decision?: string }; reply?: string };
    expect(resumeJson.resumeEcho?.decision).toBe("reject");
    await expect(page.getByText(/已按您的确认继续/).first()).toBeVisible({ timeout: 15_000 });
  });
});

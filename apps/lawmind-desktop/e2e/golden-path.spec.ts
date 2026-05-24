import { expect, test } from "@playwright/test";
import {
  approveToolViaDialog,
  assertReviewGateList,
  gotoShell,
  installE2eBrowserPrefs,
  openReviewWorkbench,
  openWorkspaceChat,
} from "./e2e-helpers";

/**
 * Golden path: shell loads → work nav reachable → review tab reachable.
 * Uses the same mock API as smoke (see e2e/dev-with-mock.sh).
 */
test.describe("LawMind golden path", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("shell loads with work navigation when mock API is ready", async ({ page }) => {
    await gotoShell(page);
    await expect(page.getByLabel("功能模块")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".lm-readiness-strip")).toHaveCount(0);
  });

  test("review workbench shows acceptance gate region when opened", async ({ page }) => {
    await gotoShell(page);
    await openReviewWorkbench(page);
    await expect(
      page.locator(".lm-review-workbench, .lm-workbench-placeholder, #lm-review-acceptance-gate").first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("tool approval card resumes without manual __approved JSON", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByRole("button", { name: /批准并继续/ })).toBeVisible({ timeout: 15_000 });
    const resumeRes = await approveToolViaDialog(page);
    const resumeJson = (await resumeRes.json()) as { resumeEcho?: { decision?: string } };
    expect(resumeJson.resumeEcho?.decision).toBe("approve");
    await expect(page.getByText(/已按您的确认继续/)).toBeVisible({ timeout: 15_000 });
    const composer = page.getByPlaceholder(/输入|消息|交办/i).first();
    if (await composer.isVisible().catch(() => false)) {
      const val = await composer.inputValue();
      expect(val).not.toMatch(/__approved/);
    }
  });

  test("tool approval edit resume sends editedArgs via API", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByRole("button", { name: "修改参数" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "修改参数" }).click();
    await page.getByLabel("工具参数 JSON").fill(
      JSON.stringify({ workflowId: "e2e-edited", __approved: true }, null, 2),
    );
    const resumeWait = page.waitForResponse(
      (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "修改后批准" }).click();
    const resumeRes = await resumeWait;
    const resumeJson = (await resumeRes.json()) as {
      resumeEcho?: { decision?: string; editedArgs?: Record<string, unknown> };
    };
    expect(resumeJson.resumeEcho?.decision).toBe("edit");
    expect(resumeJson.resumeEcho?.editedArgs?.workflowId).toBe("e2e-edited");
    await expect(page.getByText(/已按您的确认继续/)).toBeVisible({ timeout: 15_000 });
  });

  test("queues second message while first chat request is in flight", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const composer = page.getByPlaceholder(/Enter 发送|输入|消息/i).first();
    await expect(composer).toBeVisible({ timeout: 15_000 });
    const slowResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/chat") &&
        res.request().method() === "POST" &&
        !res.url().includes("/resume"),
      { timeout: 20_000 },
    );
    const slowRequest = page.waitForRequest(
      (req) =>
        req.url().includes("/api/chat") &&
        req.method() === "POST" &&
        !req.url().includes("/resume"),
    );
    await composer.fill("e2e-slow-first");
    await page.getByRole("button", { name: "发送" }).click();
    await slowRequest;
    await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 5_000 });
    await composer.fill("e2e-queued-second");
    await composer.press("Enter");
    await expect(page.locator(".lm-compose-queue")).toContainText("排队中", { timeout: 5_000 });
    await slowResponse;
  });

  test("compose permission mode select is available in workspace chat", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    const perm = page.getByLabel("工具权限模式");
    await expect(perm).toBeVisible({ timeout: 15_000 });
    await perm.selectOption("strict");
    await expect(perm).toHaveValue("strict");
  });

  test("review gate list renders blocking decision copy when present", async ({ page }) => {
    await gotoShell(page);
    await openReviewWorkbench(page);
    await assertReviewGateList(page);
  });
});

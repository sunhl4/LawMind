import { expect, test } from "@playwright/test";
import {
  approveToolViaDialog,
  e2eMockApiBase,
  ensureReviewMetaPaneVisible,
  gotoShell,
  installE2eBrowserPrefs,
  openComposeOptions,
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
    await expect(page.locator(".lm-readiness-strip")).toHaveCount(0, { timeout: 30_000 });
  });

  test("review workbench shows acceptance gate region when opened", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoShell(page);
    await openReviewWorkbench(page);
    await expect(page.locator(".lm-review-workbench-root")).toBeVisible({ timeout: 30_000 });
    const draftSelect = page.locator("select.lm-review-draft-select");
    if (await draftSelect.isVisible().catch(() => false)) {
      const options = await draftSelect.locator("option").all();
      if (options.length > 1) {
        await draftSelect.selectOption({ index: 1 }).catch(async () => {
          await draftSelect.selectOption("e2e-draft-1").catch(() => undefined);
        });
      }
    }
    await ensureReviewMetaPaneVisible(page);
    await expect(page.locator("#lm-review-acceptance-gate")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/出稿检查/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-review-export-blockers")).toBeVisible({ timeout: 15_000 });
  });

  test("tool approval card resumes without manual __approved JSON", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByRole("button", { name: /批准并继续|允许一次/ })).toBeVisible({
      timeout: 15_000,
    });
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
    await expect(page.getByRole("button", { name: "改拟稿…" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "改拟稿…" }).click();
    await expect(page.getByTestId("lm-tool-args-edit-dialog")).toBeVisible();
    await page.getByLabel("办案流程").fill("e2e-edited");
    const resumeWait = page.waitForResponse(
      (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "按修改批准" }).click();
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
    await openComposeOptions(page);
    const perm = page.getByTestId("lm-compose-permission-mode");
    await expect(perm).toBeVisible({ timeout: 15_000 });
    await perm.selectOption("strict");
    await expect(perm).toHaveValue("strict");
  });

  test("review gate metadata exposes blocking decisions via API", async ({ page }) => {
    await gotoShell(page);
    const draftRes = await page.request.get(`${e2eMockApiBase()}/api/drafts/e2e-draft-1`);
    expect(draftRes.ok()).toBe(true);
    const body = (await draftRes.json()) as {
      gateDecisions?: Array<{ gate?: string; reason?: string }>;
      acceptance?: { deliverableType?: string };
    };
    expect(body.acceptance?.deliverableType).toBe("contract.review");
    expect(body.gateDecisions?.length).toBeGreaterThan(0);
    expect(
      body.gateDecisions?.some((g) => /等待律师签批|验收门禁|审批门禁/.test(g.reason ?? "")),
    ).toBe(true);
  });
});

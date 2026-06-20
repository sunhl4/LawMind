import { expect, type Page } from "@playwright/test";

export const E2E_FIRST_RUN_DISMISS_KEY = "lm.firstRun.dismissed";

/** Mock LawMind API base (must match `LAWMIND_E2E_MOCK_PORT` in playwright webServer). */
export function e2eMockApiBase(): string {
  const port = process.env.LAWMIND_E2E_MOCK_PORT ?? "48888";
  return `http://127.0.0.1:${port}`;
}

/** Skip auto-opening LawMind first-run wizard and reset UI prefs that break E2E layout. */
export function installE2eBrowserPrefs(page: { addInitScript: Page["addInitScript"] }): Promise<void> {
  return page.addInitScript((firstRunKey) => {
    localStorage.setItem(firstRunKey, "1");
    localStorage.setItem("lawmind.ui.sidebarCollapsed", "0");
    const reviewPaneKeys = [
      "lawmind.ui.reviewPaneMeta",
      "lawmind.ui.reviewPaneEditor",
      "lawmind.ui.reviewPanePreview",
    ];
    for (const key of reviewPaneKeys) {
      localStorage.setItem(key, "1");
    }
  }, E2E_FIRST_RUN_DISMISS_KEY);
}

/** @deprecated Use installE2eBrowserPrefs */
export function installE2eFirstRunDismiss(page: { addInitScript: Page["addInitScript"] }): Promise<void> {
  return installE2eBrowserPrefs(page);
}

/** Apply E2E localStorage prefs on an already-loaded page and reload once. */
export async function bootstrapE2ePage(page: Page): Promise<void> {
  await page.evaluate((firstRunKey) => {
    localStorage.setItem(firstRunKey, "1");
    localStorage.setItem("lawmind.ui.sidebarCollapsed", "0");
    const reviewPaneKeys = [
      "lawmind.ui.reviewPaneMeta",
      "lawmind.ui.reviewPaneEditor",
      "lawmind.ui.reviewPanePreview",
    ];
    for (const key of reviewPaneKeys) {
      localStorage.setItem(key, "1");
    }
  }, E2E_FIRST_RUN_DISMISS_KEY);
  await page.reload();
  await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
  await dismissBlockingDialogs(page);
}

/** Ensure review meta pane is visible (gate list lives there; meta defaults hidden). */
export async function ensureReviewMetaPaneVisible(page: Page): Promise<void> {
  const gateList = page.locator(".lm-review-gate-list").first();
  if (await gateList.isVisible().catch(() => false)) {
    return;
  }
  const metaToggle = page.getByRole("button", { name: "签批", exact: true });
  if (!(await metaToggle.isVisible().catch(() => false))) {
    return;
  }
  if ((await metaToggle.getAttribute("aria-pressed")) !== "true") {
    await metaToggle.click({ force: true });
  }
  await expect(gateList).toBeVisible({ timeout: 15_000 });
}

/** Dismiss blocking dialogs if they still appear (e.g. stale storage). */
export async function dismissBlockingDialogs(page: Page): Promise<void> {
  const firstRun = page.getByRole("dialog", { name: /LawMind 新手引导|LawMind 首次配置|API/i });
  if (await firstRun.isVisible({ timeout: 10_000 }).catch(() => false)) {
    const dismiss = firstRun.getByRole("button", { name: /稍后再说|不用了|跳过|关闭/i }).first();
    await dismiss.click({ force: true });
    await expect(firstRun).toBeHidden({ timeout: 15_000 });
  }
  const apiWizard = page.getByRole("dialog", { name: /API/i });
  if (await apiWizard.isVisible({ timeout: 1000 }).catch(() => false)) {
    const close = apiWizard.getByRole("button", { name: /关闭|取消|跳过/i }).first();
    await close.click({ force: true }).catch(() => undefined);
    await expect(apiWizard).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
  }
}

export async function gotoShell(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 60_000 });
  await dismissBlockingDialogs(page);
  await Promise.all([
    page
      .waitForResponse((res) => res.url().includes("/api/models") && res.ok(), { timeout: 30_000 })
      .catch(() => undefined),
    page
      .waitForResponse((res) => res.url().includes("/api/bootstrap") && res.ok(), { timeout: 30_000 })
      .catch(() => undefined),
    page
      .waitForResponse((res) => res.url().includes("/api/matters/overviews") && res.ok(), {
        timeout: 30_000,
      })
      .catch(() => undefined),
  ]);
  await expect(page.locator(".lm-readiness-strip")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "功能模块" })).toBeVisible({ timeout: 30_000 });
  // Wait for API-backed chrome (mock: actionSummary.total=1) — use header trigger to avoid sidebar ambiguity
  await expect(page.locator(".lm-action-hub-trigger")).toBeVisible({ timeout: 60_000 });
}

async function leaveSettingsIfOpen(page: Page): Promise<void> {
  const settingsRegion = page.getByRole("region", { name: "设置" });
  if (await settingsRegion.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(settingsRegion).toHaveCount(0, { timeout: 15_000 });
  }
}

export async function openReviewWorkbench(page: Page): Promise<void> {
  await dismissBlockingDialogs(page);
  await leaveSettingsIfOpen(page);

  // Click the review tab using Playwright's native click
  const reviewTab = page.locator('nav[aria-label="功能模块"] >> button:text-is("审核")');
  await expect(reviewTab).toBeVisible({ timeout: 30_000 });
  await reviewTab.click();

  // Wait for either the review workbench OR workspace pane to still be present.
  // If clicking worked, we should see .lm-review-workbench-root or .lm-main-workbench containing it.
  await page.waitForFunction(
    () => document.querySelector(".lm-review-workbench-root") !== null,
    { timeout: 60_000 }
  );
}

/** Open matter cockpit in browser E2E (no Electron filesystem bridge). */
export async function openMatterCockpit(page: Page): Promise<void> {
  await dismissBlockingDialogs(page);
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  await expect(mainNav).toBeVisible({ timeout: 30_000 });
  const collabTab = mainNav.getByRole("button", { name: "协作", exact: true });
  await collabTab.click({ force: true });
  await expect(collabTab).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
  const matterRow = page.locator(".lm-matter-sidebar-list-ul button").first();
  await expect(matterRow).toBeVisible({ timeout: 30_000 });
  await matterRow.click({ force: true });
  await expect(page.locator(".lm-matter-workbench").first()).toBeVisible({ timeout: 30_000 });
}

/** Inline「批准并继续」会打开 ToolApprovalDialog；确认后才会 POST /api/chat/resume。 */
export async function approveToolViaDialog(page: Page): Promise<import("@playwright/test").Response> {
  const resumeWait = page.waitForResponse(
    (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: /批准并继续/ }).click();
  const dialog = page.getByRole("dialog", { name: /工具批准|工作流|只读|验收|外联/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "允许一次" }).click();
  return resumeWait;
}

export async function openWorkspaceChat(page: Page): Promise<void> {
  await dismissBlockingDialogs(page);
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  const chatTab = mainNav.getByRole("button", { name: "对话" });
  await chatTab.click({ force: true });
  await expect(chatTab).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "对话消息" })).toBeVisible({ timeout: 30_000 });
}

/** Open review tab, load mock draft detail, assert gate copy is visible. */
export async function assertReviewGateList(page: Page): Promise<void> {
  const detailWait = page.waitForResponse(
    (res) =>
      res.request().method() === "GET" &&
      new URL(res.url()).pathname.endsWith('/api/drafts/e2e-draft-1') &&
      res.ok(),
    { timeout: 30_000 },
  );
  await openReviewWorkbench(page);
  await page
    .waitForResponse(
      (res) => {
        const path = new URL(res.url()).pathname;
        return res.request().method() === "GET" && path.endsWith("/api/drafts") && res.ok();
      },
      { timeout: 30_000 },
    )
    .catch(() => undefined);

  const detailRes = await detailWait;
  const detailJson = (await detailRes.json()) as { gateDecisions?: Array<{ reason?: string }> };
  expect(
    detailJson.gateDecisions?.some((g) => /等待律师签批|验收门禁|审批门禁/.test(g.reason ?? "")),
  ).toBe(true);

  await ensureReviewMetaPaneVisible(page);
  await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("执行状态看板")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".lm-review-detail-row")).toContainText(
    /等待律师签批|验收门禁|审批门禁/,
    { timeout: 30_000 },
  );
}

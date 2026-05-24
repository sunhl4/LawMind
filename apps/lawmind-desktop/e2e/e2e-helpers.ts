import { expect, type Page } from "@playwright/test";

export const E2E_FIRST_RUN_DISMISS_KEY = "lm.firstRun.dismissed";

/** Skip auto-opening LawMind first-run wizard and reset UI prefs that break E2E layout. */
export function installE2eBrowserPrefs(page: { addInitScript: Page["addInitScript"] }): Promise<void> {
  return page.addInitScript((firstRunKey) => {
    localStorage.setItem(firstRunKey, "1");
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

export async function openReviewWorkbench(page: Page): Promise<void> {
  await dismissBlockingDialogs(page);
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  const reviewTab = mainNav.getByRole("button", { name: "审核" });
  await reviewTab.click({ force: true });
  await expect(reviewTab).toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.getByRole("toolbar", { name: "审核台分栏" }).first()).toBeVisible({ timeout: 30_000 });
}

/** Pick first draft from the review toolbar and assert gate list shows blocking copy. */
export async function assertReviewGateList(page: Page): Promise<void> {
  const draftSelect = page.getByRole("combobox", { name: "选择草稿" });
  await expect(draftSelect).toBeVisible({ timeout: 30_000 });
  const detailResponse = page
    .waitForResponse(
      (res) =>
        res.request().method() === "GET" &&
        /\/api\/drafts\/[^/]+$/.test(new URL(res.url()).pathname) &&
        res.ok(),
      { timeout: 8_000 },
    )
    .catch(() => null);
  await draftSelect.selectOption({ index: 1 });
  const detailRes = await detailResponse;
  if (detailRes) {
    const detailJson = (await detailRes.json()) as { gateDecisions?: Array<{ reason?: string }> };
    expect(detailJson.gateDecisions?.some((g) => /等待律师签批|验收门禁/.test(g.reason ?? ""))).toBe(
      true,
    );
  }
  await expect(draftSelect).not.toHaveValue("", { timeout: 15_000 });
  await ensureReviewMetaPaneVisible(page);
  await expect(page.locator(".lm-review-gate-list").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".lm-review-gate-list").first()).toContainText(/等待律师签批|验收门禁|审批门禁/);
}

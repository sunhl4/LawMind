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
  // 待我拍板 only appears when there are pending decisions (mock returns ≥1).
  await expect(page.getByRole("navigation", { name: "功能模块" })).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByTestId("lm-side-needs-decision")
      .or(page.getByTestId("lm-side-action-hub"))
      .or(page.locator(".lm-needs-decision-trigger"))
      .or(page.locator(".lm-action-hub-trigger"))
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  // Wait for mock health (modelConfigured) so readiness strip clears before chat assertions.
  await expect(page.locator(".lm-readiness-strip")).toHaveCount(0, { timeout: 45_000 });
  // Chat messages region (or at least the workspace chat chrome) should be reachable on default home.
  await expect(
    page.locator("#lawmind-chat-messages-panel").or(page.getByRole("region", { name: "对话消息" })).first(),
  ).toBeVisible({ timeout: 30_000 });
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

  // 文书台是场景化深工具：从「在办」总览进入（侧栏「待我拍板」也跳转到办）。
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  await expect(mainNav).toBeVisible({ timeout: 30_000 });
  const agentsTab = mainNav.getByRole("button", { name: "在办", exact: true });
  if (await agentsTab.isVisible().catch(() => false)) {
    await agentsTab.click();
  } else {
    const sidebarHub = page.getByTestId("lm-side-needs-decision").or(page.getByTestId("lm-side-action-hub"));
    await expect(sidebarHub).toBeVisible({ timeout: 30_000 });
    await sidebarHub.click();
  }
  await expect(page.locator(".lm-agent-fleet-page")).toBeVisible({ timeout: 30_000 });

  const openWorkbench = page
    .getByTestId("lm-fleet-primary-review")
    .or(page.getByRole("button", { name: /进入文书台/ }))
    .first();
  await expect(openWorkbench).toBeVisible({ timeout: 30_000 });
  await openWorkbench.click();

  await page.waitForFunction(
    () => document.querySelector(".lm-review-workbench-root") !== null,
    { timeout: 60_000 },
  );
}

/** Open matter cockpit in browser E2E (no Electron filesystem bridge). */
export async function openMatterCockpit(page: Page): Promise<void> {
  await dismissBlockingDialogs(page);
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  await expect(mainNav).toBeVisible({ timeout: 30_000 });
  const agentsTab = mainNav.getByRole("button", { name: "在办", exact: true });
  if (await agentsTab.isVisible().catch(() => false)) {
    await agentsTab.click({ force: true });
    await expect(agentsTab).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
    const matterRow = page.locator(".lm-matter-sidebar-list-ul button").first();
    await expect(matterRow).toBeVisible({ timeout: 30_000 });
    await matterRow.click({ force: true });
  } else {
    // Fallback when 在办 tab is not yet painted: open via header matter chip / sidebar list.
    const headerMatter = page.getByTestId("lm-open-matter-cockpit");
    await expect(headerMatter).toBeVisible({ timeout: 30_000 });
    await headerMatter.click();
  }
  await expect(page.locator(".lm-matter-workbench").first()).toBeVisible({ timeout: 30_000 });
}

/** Open compose 「+」 so permission / web / mode controls are in the DOM. */
export async function openComposeOptions(page: Page): Promise<void> {
  const plus = page.getByRole("button", { name: "输入选项" });
  await expect(plus).toBeVisible({ timeout: 15_000 });
  if ((await plus.getAttribute("aria-expanded")) !== "true") {
    await plus.click();
  }
  await expect(page.getByLabel("工具权限模式")).toBeVisible({ timeout: 5_000 });
}

/** Inline「批准并继续」直接 POST /api/chat/resume（不再二次弹窗）。 */
export async function approveToolViaDialog(page: Page): Promise<import("@playwright/test").Response> {
  const resumeWait = page.waitForResponse(
    (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: /批准并继续/ }).click();
  return resumeWait;
}

/** Inline「暂不执行」→ POST /api/chat/resume with reject. */
export async function rejectToolViaCard(page: Page): Promise<import("@playwright/test").Response> {
  const resumeWait = page.waitForResponse(
    (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: /暂不执行/ }).click();
  return resumeWait;
}

export async function openWorkspaceChat(page: Page): Promise<void> {
  await dismissBlockingDialogs(page);
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  const chatTab = mainNav.getByRole("button", { name: "对话" });
  await chatTab.click({ force: true });
  await expect(chatTab).toHaveAttribute("aria-current", "page");
  await expect(
    page.locator("#lawmind-chat-messages-panel").or(page.getByRole("region", { name: "对话消息" })).first(),
  ).toBeVisible({ timeout: 30_000 });
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

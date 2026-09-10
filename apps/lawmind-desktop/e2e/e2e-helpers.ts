import { expect, type Page } from "@playwright/test";

export const E2E_FIRST_RUN_DISMISS_KEY = "lm.firstRun.dismissed";

/** Mock LawMind API base (must match `LAWMIND_E2E_MOCK_PORT` in playwright webServer). */
export function e2eMockApiBase(): string {
  const port = process.env.LAWMIND_E2E_MOCK_PORT ?? "48888";
  return `http://127.0.0.1:${port}`;
}

/** Skip auto-opening LawMind first-run wizard and reset UI prefs that break E2E layout.
 * Also injects the Electron preload boot stub — the renderer no longer boots as a web page. */
export async function installE2eBrowserPrefs(page: {
  addInitScript: Page["addInitScript"];
}): Promise<void> {
  await installE2eDesktopBootStub(page);
  await page.addInitScript((firstRunKey) => {
    localStorage.setItem(firstRunKey, "1");
    localStorage.setItem("lawmind.ui.sidebarCollapsed", "0");
    // E3′：不强制写入；靠产品默认（未设置 = 签批后自动导出）
    localStorage.removeItem("lawmind.review.autoExportOnApprove");
    localStorage.removeItem("lawmind.review.requireSignoffReview");
    localStorage.setItem("lawmind.ui.wsPaneEditor", "1");
    localStorage.setItem("lawmind.ui.wsPaneChat", "1");
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

/**
 * Minimal Electron preload so the desktop renderer can boot in Playwright.
 * Does not expose fsList — file tree stays off unless installE2eDesktopBridge is used.
 */
export function installE2eDesktopBootStub(page: { addInitScript: Page["addInitScript"] }): Promise<void> {
  const apiBase = e2eMockApiBase();
  return page.addInitScript((api) => {
    (window as unknown as { lawmindDesktop: Record<string, unknown> }).lawmindDesktop = {
      getConfig: async () => ({
        apiBase: api,
        workspaceDir: "/tmp/lawmind-e2e-ws",
        projectDir: null,
        envFilePath: "",
        retrievalMode: "single",
        packaged: false,
        appVersion: "e2e",
        downloadPageUrl: "https://docs.lawmind.ai/download/",
      }),
      openExternal: async () => undefined,
      showNotification: async () => undefined,
    };
  }, apiBase);
}

/**
 * Electron preload stub with a fake file tree. Opt-in for file→fast-lane paths.
 */
export function installE2eDesktopBridge(page: { addInitScript: Page["addInitScript"] }): Promise<void> {
  const apiBase = e2eMockApiBase();
  return page.addInitScript((api) => {
    const mtime = Date.now();
    const tree: Record<string, Array<{ name: string; path: string; kind: "file" | "directory"; size?: number; mtimeMs: number }>> = {
      "": [
        { name: "contracts", path: "contracts", kind: "directory", mtimeMs: mtime },
        { name: "cases", path: "cases", kind: "directory", mtimeMs: mtime },
      ],
      contracts: [
        {
          name: "nda.docx",
          path: "contracts/nda.docx",
          kind: "file",
          size: 2048,
          mtimeMs: mtime,
        },
      ],
      cases: [
        { name: "e2e-matter-1", path: "cases/e2e-matter-1", kind: "directory", mtimeMs: mtime },
      ],
      "cases/e2e-matter-1": [],
    };
    // Minimal bridge: getConfig without "(" so canUseFilesystemBridge=true; office open needs no fsRead.
    (window as unknown as { lawmindDesktop: Record<string, unknown> }).lawmindDesktop = {
      getConfig: async () => ({
        apiBase: api,
        workspaceDir: "/tmp/lawmind-e2e-ws",
        projectDir: null,
        envFilePath: "",
        retrievalMode: "single",
        packaged: false,
        appVersion: "e2e",
        downloadPageUrl: "https://docs.lawmind.ai/download/",
      }),
      fsList: async (payload: { path?: string }) => {
        const key = String(payload?.path ?? "");
        return { ok: true, entries: tree[key] ?? [] };
      },
      fsRead: async () => ({ ok: false, error: "binary file" }),
      fsWrite: async () => ({ ok: false, error: "e2e stub read-only" }),
      showItemInFolder: async () => ({ ok: true }),
      openWithSystem: async () => ({ ok: true }),
      openExternal: async () => undefined,
      showNotification: async () => undefined,
    };
  }, apiBase);
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
    // E3′：与 installE2eBrowserPrefs 对齐 — 依赖产品默认自动导出
    localStorage.removeItem("lawmind.review.autoExportOnApprove");
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

/** Open review workbench, wait for the draft list, then select `taskId`. */
export async function openReviewDraft(page: Page, taskId = "e2e-draft-1"): Promise<void> {
  await openReviewWorkbench(page);
  const count = page.locator(".lm-review-draft-toolbar-count");
  await expect(count).not.toHaveText("…", { timeout: 20_000 });

  const allTab = page.getByRole("tab", { name: "全部", exact: true });
  await expect(allTab).toBeVisible({ timeout: 15_000 });
  await allTab.click();
  await expect(allTab).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

  const statusSelect = page.getByRole("combobox", { name: "签批状态" });
  if (await statusSelect.isVisible().catch(() => false)) {
    await statusSelect.selectOption("all");
  }

  const draftSelect = page.getByRole("combobox", { name: "选择草稿" });
  await expect(draftSelect).toBeEnabled({ timeout: 20_000 });
  await expect(draftSelect.locator(`option[value="${taskId}"]`)).toBeAttached({
    timeout: 15_000,
  });
  await draftSelect.selectOption(taskId);
  await expect(draftSelect).toHaveValue(taskId);
  await expect(page.getByText("在上方选择草稿后开始改稿与预览")).toHaveCount(0, {
    timeout: 20_000,
  });
  await ensureReviewMetaPaneVisible(page);
}

/** Ensure review meta side pane + advanced section are open (acceptance gate / gate list live there). */
export async function ensureReviewMetaPaneVisible(page: Page): Promise<void> {
  const acceptanceGate = page.locator("#lm-review-acceptance-gate").first();
  const gateList = page.locator(".lm-review-gate-list").first();
  const metaToggle = page.getByRole("button", { name: "更多", exact: true });
  if (await metaToggle.isVisible().catch(() => false)) {
    if ((await metaToggle.getAttribute("aria-pressed")) !== "true") {
      await metaToggle.click({ force: true });
    }
  }
  const checkPack = page.getByTestId("lm-review-check-pack");
  await expect(checkPack.or(acceptanceGate).or(gateList).first()).toBeVisible({ timeout: 20_000 });
  if (await checkPack.isVisible().catch(() => false)) {
    if ((await checkPack.getAttribute("open")) === null) {
      await checkPack.locator("summary.lm-review-check-pack-summary").click({ force: true });
    }
  }
  const advanced = page.locator("details.lm-review-advanced").first();
  if (await advanced.isVisible().catch(() => false)) {
    const open = await advanced.getAttribute("open");
    if (open === null) {
      await advanced.locator("summary.lm-review-advanced-summary").click({ force: true });
    }
  }
  await expect(acceptanceGate.or(gateList).first()).toBeVisible({ timeout: 15_000 });
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
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .or(page.getByRole("navigation", { name: "功能模块" }))
      .or(page.getByTestId("lm-cockpit-nav"))
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByTestId("lm-side-needs-decision")
      .or(page.getByTestId("lm-side-action-hub"))
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  // Wait for mock health (modelConfigured) so readiness strip clears before chat assertions.
  await expect(page.locator(".lm-readiness-strip")).toHaveCount(0, { timeout: 45_000 });
  await expect(
    page
      .locator("#lawmind-chat-messages-panel")
      .or(page.getByRole("region", { name: "对话消息" }))
      .first(),
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

  // 改稿/文书台不占一级；从「在办」主 CTA「改稿」进入（已打开时顶栏才有次级定位）。
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  await expect(mainNav).toBeVisible({ timeout: 30_000 });
  const reviewTab = mainNav.getByTestId("lm-tab-review");
  if (await reviewTab.isVisible().catch(() => false)) {
    await reviewTab.click();
  } else {
    const agentsTab = mainNav.getByRole("button", { name: "在办", exact: true });
    await agentsTab.click();
    await expect(page.locator(".lm-agent-fleet-page")).toBeVisible({ timeout: 30_000 });
    const openWorkbench = page
      .getByTestId("lm-agents-open-review")
      .or(page.getByTestId("lm-fleet-primary-review"))
      .or(page.getByTestId("lm-ceremony-open-review"))
      .or(page.getByTestId("lm-fleet-empty-review"))
      .or(page.getByRole("button", { name: /改稿|文书台/ }))
      .first();
    await expect(openWorkbench).toBeVisible({ timeout: 30_000 });
    await openWorkbench.click();
  }

  await page.waitForFunction(
    () => document.querySelector(".lm-review-workbench-root") !== null,
    { timeout: 60_000 },
  );
}

/** Open matter cockpit (sidebar 在办 → first matter). */
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

/** Open compose 「办件」 process list. */
export async function openDeskWork(page: Page): Promise<void> {
  const btn = page.getByTestId("lm-compose-desk-work");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  if ((await btn.getAttribute("aria-expanded")) !== "true") {
    await btn.click();
  }
  await expect(page.getByTestId("lm-desk-work-panel")).toBeVisible({ timeout: 5_000 });
}

/** Open 「办件 → 更多」 so secondary lanes (检索研究 / 写材料 / …) are visible. */
export async function openDeskWorkMore(page: Page): Promise<void> {
  await openDeskWork(page);
  const more = page.getByTestId("lm-desk-work-more");
  await expect(more).toBeVisible({ timeout: 5_000 });
  const open = await more.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!open) {
    await more.locator("summary").click();
  }
  await expect
    .poll(async () => more.evaluate((el) => (el as HTMLDetailsElement).open))
    .toBe(true);
}

/** Open compose 「+」 so permission / web / mode controls are in the DOM. */
export async function openComposeOptions(page: Page): Promise<void> {
  const plus = page.getByRole("button", { name: "输入选项" });
  await expect(plus).toBeVisible({ timeout: 15_000 });
  if ((await plus.getAttribute("aria-expanded")) !== "true") {
    await plus.click();
  }
  await expect(page.getByTestId("lm-compose-permission-mode")).toBeVisible({ timeout: 5_000 });
}

/** Inline「批准并继续」直接 POST /api/chat/resume（不再二次弹窗）。 */
export async function approveToolViaDialog(page: Page): Promise<import("@playwright/test").Response> {
  const resumeWait = page.waitForResponse(
    (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: /批准并继续|允许一次/ }).click();
  return resumeWait;
}

/** Inline「暂不办理」→ POST /api/chat/resume with reject. */
export async function rejectToolViaCard(page: Page): Promise<import("@playwright/test").Response> {
  const resumeWait = page.waitForResponse(
    (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: /暂不办理/ }).click();
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
  // 工作台可能已被调用方打开（Electron golden-path）：此时详情早已加载，
  // 不会再有新的 detail 响应；容忍拿不到，改用 DOM 断言兜底。
  const detailWait = page
    .waitForResponse(
      (res) =>
        res.request().method() === "GET" &&
        new URL(res.url()).pathname.endsWith('/api/drafts/e2e-draft-1') &&
        res.ok(),
      { timeout: 30_000 },
    )
    .catch(() => null);
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
  if (detailRes) {
    const detailJson = (await detailRes.json()) as {
      gateDecisions?: Array<{ reason?: string }>;
    };
    expect(
      detailJson.gateDecisions?.some((g) => /等待律师签批|出稿检查|待签批/.test(g.reason ?? "")),
    ).toBe(true);
  }

  await ensureReviewMetaPaneVisible(page);
  await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("执行状态看板")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".lm-review-detail-row")).toContainText(
    /等待律师签批|出稿检查|待签批/,
    { timeout: 30_000 },
  );
}

import { expect, test } from "@playwright/test";
import {
  e2eMockApiBase,
  e2eScopeHeaders,
  gotoShell,
  installE2eBrowserPrefs,
  openWorkspaceChat,
} from "./e2e-helpers";

/**
 * 上下文用量 UI + 「另起新对话（带上文）」的端到端接线。
 *
 * 这一层测的是**接线**：mock 返回的 `breakdown` / `window` / `compactCount` / `lastCompact`
 * 真的被渲染成面板与建议卡；点「另起新对话」真的切到新会话、并把「续接来源」卡渲染出来；
 * 待批准授权时 409 不静默切走。引擎侧的种子内容、闸门迁移与阻塞判定由
 * `session-carryover.test.ts` / `lawmind-server-route-sessions.test.ts` 覆盖，
 * 此处不重复（mock 不会替引擎做那些判断）。
 */

async function setContextBudgetMock(
  page: import("@playwright/test").Page,
  scopeId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const res = await page.request.post(`${e2eMockApiBase()}/__e2e__/context-budget`, {
    // 必须显式带 scope：`page.request` 不继承 `setExtraHTTPHeaders`，
    // 漏了就会写到 default 作用域，而页面读的是本测试的作用域。
    headers: e2eScopeHeaders(scopeId),
    data,
  });
  expect(res.ok()).toBe(true);
}

async function setForkMock(
  page: import("@playwright/test").Page,
  scopeId: string,
  mode: "ok" | "blocked",
): Promise<void> {
  const res = await page.request.post(`${e2eMockApiBase()}/__e2e__/fork`, {
    headers: e2eScopeHeaders(scopeId),
    data: { mode },
  });
  expect(res.ok()).toBe(true);
}

test.describe("上下文用量与另起新对话（带上文）", () => {
  let scopeId = "";

  test.beforeEach(async ({ page }) => {
    ({ scopeId } = await installE2eBrowserPrefs(page));
  });

  test.afterEach(async ({ page }) => {
    await page.request.post(`${e2eMockApiBase()}/__e2e__/context-budget`, {
      headers: e2eScopeHeaders(scopeId),
      data: { reset: true },
    });
    await setForkMock(page, scopeId, "ok");
  });

  test("用量圆环常驻，面板给出窗口三元组与分层用量", async ({ page }) => {
    await setContextBudgetMock(page, scopeId, { used: 80_000, effectiveLimit: 100_000, level: "warn" });
    await gotoShell(page);
    await openWorkspaceChat(page);

    // 对齐 Cursor：圆环常驻，不是只在告警时才出现。
    const ring = page.getByTestId("lm-compose-token-bar");
    await expect(ring).toBeVisible({ timeout: 20_000 });
    await ring.click();

    const panel = page.getByTestId("lm-compose-ctx-usage-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    // A4：律师能把界面数字和模型窗口对上（Codex /status 的对应物）。
    await expect(panel.getByTestId("lm-compose-ctx-window")).toContainText("模型窗口 128k");
    await expect(panel.getByTestId("lm-compose-ctx-window")).toContainText("可用 100k");
    await expect(panel.getByTestId("lm-compose-ctx-window")).toContainText("自动整理线 90k");
    // A3：分层用量（不是一个笼统的「额度」）。
    const breakdown = panel.getByTestId("lm-compose-ctx-breakdown");
    await expect(breakdown).toContainText("律师发言");
    await expect(breakdown).toContainText("工具回包");
    await expect(breakdown).toContainText("压缩摘要");
    // A2：可操作信号出现在自动整理线附近，而不是等到 100%。
    await expect(panel).toContainText("接近自动整理线");
  });

  test("压过两次后出现一次性建议卡，点「继续本对话」后不再出现", async ({ page }) => {
    await setContextBudgetMock(page, scopeId, { compactCount: 2 });
    await gotoShell(page);
    await openWorkspaceChat(page);

    const suggest = page.getByTestId("lm-ctx-fork-suggest");
    await expect(suggest).toBeVisible({ timeout: 20_000 });
    await expect(suggest).toContainText("已经整理过多次上下文");
    // 「继续本对话」必须与「另起新对话」并列，不是单方面劝走。
    await expect(page.getByTestId("lm-ctx-fork-suggest-go")).toBeVisible();
    await page.getByTestId("lm-ctx-fork-suggest-dismiss").click();
    await expect(suggest).toHaveCount(0);

    // 只是记住、不是靠隐藏 DOM：重新加载后仍不打扰。
    await page.reload({ waitUntil: "domcontentloaded" });
    await openWorkspaceChat(page);
    await expect(page.getByTestId("lm-ctx-fork-suggest")).toHaveCount(0);
  });

  test("回合内整理过（midTurn）也触发建议", async ({ page }) => {
    await setContextBudgetMock(page, scopeId, { compactCount: 1, midTurn: true });
    await gotoShell(page);
    await openWorkspaceChat(page);
    await expect(page.getByTestId("lm-ctx-fork-suggest")).toBeVisible({ timeout: 20_000 });
  });

  test("从面板另起新对话：切到新会话并显示续接来源卡", async ({ page }) => {
    await setContextBudgetMock(page, scopeId, { compactCount: 2 });
    await gotoShell(page);
    await openWorkspaceChat(page);

    await page.getByTestId("lm-compose-token-bar").click();
    const forkAction = page.getByTestId("lm-compose-fork-carryover");
    await expect(forkAction).toBeVisible({ timeout: 10_000 });
    const forkResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/fork-with-carryover") && res.request().method() === "POST",
    );
    await forkAction.click();
    const res = await forkResponse;
    expect(res.status()).toBe(200);

    // 新会话顶部：律师可核对「到底带过来了什么」（含展开摘要）。
    const notice = page.getByTestId("lm-msg-carryover-notice");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("本对话续接自「E2E session」");
    await expect(notice).toContainText("整理 18 条");
    await expect(notice).toContainText("要点提取");
    await expect(notice).toContainText("草稿、案件档案与待办都在原处");
    await notice.getByText("查看带过来的整理稿").click();
    await expect(notice).toContainText("已定位依据并写到解除条款");
  });

  test("待批准授权时拒绝另起新对话，且不切走、不静默丢授权", async ({ page }) => {
    await setContextBudgetMock(page, scopeId, { compactCount: 2 });
    await setForkMock(page, scopeId, "blocked");
    await gotoShell(page);
    await openWorkspaceChat(page);
    await page.getByTestId("lm-compose-token-bar").click();
    await page.getByTestId("lm-compose-fork-carryover").click();

    // 服务器说不行 → 如实写在对话里（不是 toast 一闪而过，也不是静默什么都没发生）。
    await expect(
      page.getByText("当前对话有未处理的批准，须先在原对话处理完再另起新对话。"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-msg-carryover-notice")).toHaveCount(0);
  });
});

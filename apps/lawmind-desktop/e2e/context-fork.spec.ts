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

  test("对话变长才出现入口，面板不展示模型窗口和用量桶", async ({ page }) => {
    await setContextBudgetMock(page, scopeId, { used: 12_000, effectiveLimit: 100_000, level: "ok", compactCount: 0 });
    const budgetLoaded = page.waitForResponse(
      (res) => res.url().includes("/context-budget") && res.ok(),
    );
    await gotoShell(page);
    await openWorkspaceChat(page);
    await budgetLoaded;
    await expect(page.getByTestId("lm-compose-token-bar")).toHaveCount(0);

    await setContextBudgetMock(page, scopeId, { used: 80_000, effectiveLimit: 100_000, level: "warn" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await openWorkspaceChat(page);

    const ring = page.getByTestId("lm-compose-token-bar");
    await expect(ring).toBeVisible({ timeout: 20_000 });
    await expect(ring).toContainText("对话较长");
    await ring.click();

    const panel = page.getByTestId("lm-compose-ctx-usage-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByTestId("lm-compose-ctx-window")).toHaveCount(0);
    await expect(panel.getByTestId("lm-compose-ctx-breakdown")).toHaveCount(0);
    await expect(panel).toContainText("这场对话开始变长");
    await expect(panel).not.toContainText("工具回包");
    await expect(panel).not.toContainText("模型窗口");
  });

  test("压过两次后出现一次性建议卡，点「继续本对话」后不再出现", async ({ page }) => {
    await setContextBudgetMock(page, scopeId, { compactCount: 2 });
    await gotoShell(page);
    await openWorkspaceChat(page);

    const suggest = page.getByTestId("lm-ctx-fork-suggest");
    await expect(suggest).toBeVisible({ timeout: 20_000 });
    await expect(suggest).toContainText("这场对话已经比较长");
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
    await expect(notice).toContainText("本对话接着「E2E session」办");
    await expect(notice).toContainText("较早的 18 条已收成要点");
    await expect(notice).not.toContainText("要点提取");
    await expect(notice).toContainText("稿子和案件材料都留在本案");
    await notice.getByText("查看带过来的要点").click();
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

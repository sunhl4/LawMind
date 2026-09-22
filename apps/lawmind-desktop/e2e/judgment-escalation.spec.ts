import { expect, test } from "@playwright/test";
import {
  e2eMockApiBase,
  gotoShell,
  installE2eBrowserPrefs,
  openReviewDraft,
} from "./e2e-helpers";

/**
 * G3 待定夺项的**旁路展示**（欠账二）。
 *
 * 背景：`block` 姿态下引擎会把待定夺卡并进 `requiresAction`，在对话里停下等确认；
 * 而 `advisory`（单人执业缺省）**刻意不打断**——那时律师唯一能看见这批判项的地方
 * 就是改稿台。所以这一组断言的是「**在审核台上真的看得见**」，而不是「组件自己能渲染」。
 *
 * 这一层测的是渲染与接线（服务端返回的姿态 → 文案口径）；真实引擎读 sidecar 的那一段
 * 由 `judgment-escalation-electron.spec.ts` 在真机 Electron + 真实本地服务上覆盖。
 */
async function setJudgmentMock(
  page: import("@playwright/test").Page,
  mode: "items" | "empty" | "error",
  posture: "advisory" | "block",
): Promise<void> {
  const res = await page.request.post(`${e2eMockApiBase()}/__e2e__/judgment`, {
    data: { mode, posture },
  });
  expect(res.ok()).toBe(true);
}

test.describe("G3 待定夺项 · 审核台旁路展示", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test.afterEach(async ({ page }) => {
    // 单 mock 服务器跨 spec 共享，用完必须复位（否则别的 spec 的审核台会多出一张卡）。
    await page.request.post(`${e2eMockApiBase()}/__e2e__/judgment`, {
      data: { mode: "empty", posture: "block" },
    });
  });

  test("advisory：不改流程也能看见「系统没替您决定」的那几项", async ({ page }) => {
    await setJudgmentMock(page, "items", "advisory");
    await gotoShell(page);
    await openReviewDraft(page, "e2e-draft-1");

    const card = page.getByTestId("lm-judgment-escalation");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-variant", "inline");
    await expect(card).toHaveAttribute("data-posture", "advisory");
    await expect(card).toContainText("责任上限的水平");
    await expect(card).toContainText("属商业风险分配");
    await expect(card).toContainText("验收标准写多严");
    // advisory 没有停下流程——文案必须这么说，不能让律师以为被卡住。
    await expect(card).toContainText("不打断当前流程");
    await expect(card).not.toContainText("不会替您选一条路继续");
  });

  test("block：口径相反——明说已经停下等确认", async ({ page }) => {
    await setJudgmentMock(page, "items", "block");
    await gotoShell(page);
    await openReviewDraft(page, "e2e-draft-1");

    const card = page.getByTestId("lm-judgment-escalation");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-posture", "block");
    await expect(card).toContainText("不会替您选一条路继续");
    await expect(card).not.toContainText("不打断当前流程");
  });

  test("没有待定夺项时整块不出现（不给每份稿子加噪声）", async ({ page }) => {
    await setJudgmentMock(page, "empty", "advisory");
    await gotoShell(page);
    await openReviewDraft(page, "e2e-draft-1");

    // 先确认审核台确实渲染了（否则「没有这张卡」可能只是因为工作台没打开）。
    await expect(page.locator(".lm-review-workbench-root").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-decision-header")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-judgment-escalation")).toHaveCount(0);
  });

  test("读不到时出声——故障不得冒充「没有待办」", async ({ page }) => {
    await setJudgmentMock(page, "error", "advisory");
    await gotoShell(page);
    await openReviewDraft(page, "e2e-draft-1");

    const card = page.getByTestId("lm-judgment-escalation");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-state", "error");
    await expect(card).toContainText("读不到");
  });
});

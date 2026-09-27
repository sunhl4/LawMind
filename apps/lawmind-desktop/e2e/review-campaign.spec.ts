import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openReviewDraft } from "./e2e-helpers";

/**
 * 审查专案组（Skills E2）在改稿台上的**接线**测试。
 *
 * 这条用例改过一轮，因为它的旧断言与产品当前口径**直接冲突**，而它从写下那天起就没绿过：
 *
 * | 旧断言 | 为什么不能这么写 |
 * | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
 * | 改稿台一打开就看得见专案组面板       | 面板当时被放在默认折叠的「高级 · 签批」`<details>` 里 → 永远 `hidden`。产品侧已把面板移出折叠区（折叠区的标题说的是签批，不是跑专案组） |
 * | 跑一次后出现「Safety Score」         | 启发式 Safety Score **已被刻意移除**：`LawmindReviewCampaignPanel.test.tsx` 里有一条「不展示启发式 Safety Score，显示真实核对指标」 |
 *
 * 所以这里断言的是**今天的产品契约**：面板在改稿台可见、跑得动、给出真实计数与五个角色 Tab、
 * 报告可看可下载。刻意**不**再断言那个分数——它是一条被否决过的设计，不该由 e2e 把它拉回来。
 */

test.describe("审查专案组 (Skills E2)", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("在办跑专案组：真实计数 + 角色 Tab + 报告下载", async ({ page }) => {
    await gotoShell(page);
    await openReviewDraft(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench")).toHaveCount(0);

    // 面板必须**不需要先展开折叠区**就能看见：它是跑审查的入口 + 结果看板。
    const panel = page.getByTestId("lm-review-campaign");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    await panel.getByTestId("lm-review-campaign-run").click();

    const roles = page.getByTestId("lm-review-campaign-roles");
    await expect(roles).toBeVisible({ timeout: 15_000 });
    // mock 给的是标准五角色。
    await expect(roles.getByRole("tab")).toHaveCount(5, { timeout: 10_000 });

    // 真实核对指标（而不是被移除的启发式分数）。
    await expect(panel).toContainText("条规则");
    await expect(panel).toContainText("处问题");
    await expect(panel).not.toContainText("Safety Score");

    await panel.getByTestId("lm-review-campaign-report-btn").click();
    await expect(page.getByTestId("lm-review-campaign-report")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("lm-review-campaign-download")).toBeVisible();
  });
});

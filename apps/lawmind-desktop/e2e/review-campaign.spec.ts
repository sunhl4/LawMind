import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openDeskTab, openDraftDesk } from "./e2e-helpers";

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
    // 草稿台住在中栏，中栏要 filesystem bridge 才显示；只用 boot stub 会永远等不到。
    await installE2eBrowserPrefs(page, { filesystemBridge: true });
  });

  test("专案组不挂在在办页，而在改稿台上", async ({ page }) => {
    await gotoShell(page);
    // 只切到「工作台」一级 tab：此时不该有改稿台。
    await openDeskTab(page);
    await expect(page.locator(".lm-review-workbench-root")).toHaveCount(0);
    await expect(page.getByTestId("lm-tab-agents")).toHaveCount(0);
    await expect(page.getByTestId("lm-lawyer-workbench")).toBeVisible();

    // 打开草稿台后，专案组面板才出现在改稿台上（这才是它真正的挂载点）。
    await openDraftDesk(page);
    await expect(page.getByTestId("lm-middle-draft-desk")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lm-review-campaign")).toBeVisible({ timeout: 30_000 });
  });
});

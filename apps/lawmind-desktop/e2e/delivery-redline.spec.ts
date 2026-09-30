import { expect, test } from "@playwright/test";
import {
  e2eMockApiBase,
  gotoShell,
  installE2eBrowserPrefs,
  openReviewDraft,
  openWorkspaceChat,
} from "./e2e-helpers";

test.describe("交付链路：红线 / 审阅稿 / 删除草稿 / 澄清 resume", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
    await page.request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });

  test("修订不在改稿台，顶栏没有在办", async ({ page }) => {
    await gotoShell(page);
    await openReviewDraft(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-redline-item")).toHaveCount(0);
    await expect(page.getByTestId("lm-tab-agents")).toHaveCount(0);
    await expect(page.getByTestId("lm-lawyer-workbench")).toBeVisible();
  });

  test("待发出不在单独的在办页", async ({ page }) => {
    await gotoShell(page);
    await openReviewDraft(page);
    await expect(page.getByTestId("lm-fleet-discard-pending-draft")).toHaveCount(0);
    await expect(page.getByTestId("lm-lawyer-workbench")).toBeVisible();
  });

  test("对话内澄清提交走 /api/chat/resume 并带 clarificationAnswers", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);

    const composer = page.getByRole("textbox", { name: "消息输入" });
    await composer.fill("e2e-clarify 请补充租金与押金后起草");
    await composer.press("Enter");

    const card = page.getByTestId("lm-decision-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("待澄清");

    const fields = card.locator("input, textarea");
    await fields.nth(0).fill("5000元/月");
    await fields.nth(1).fill("押一付三");

    const resumeWait = page.waitForResponse(
      (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
    );
    await card.getByRole("button", { name: /提交补充并继续|填好并发送/ }).click();
    const res = await resumeWait;
    const body = res.request().postDataJSON() as {
      decision?: string;
      clarificationAnswers?: Record<string, string>;
    };
    expect(body.decision).toBe("respond");
    expect(body.clarificationAnswers?.rent).toContain("5000");
    expect(body.clarificationAnswers?.deposit).toContain("押一付三");
  });
});

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

  test("redline surgical 上下文内联高亮并接受", async ({ page }) => {
    await gotoShell(page);
    await openReviewDraft(page);

    // redline 面板在高级折叠区：未展开时先点开。
    const itemProbe = page.locator(".lm-review-redline-item").first();
    if (!(await itemProbe.isVisible().catch(() => false))) {
      const advanced = page.locator("details.lm-review-advanced").first();
      if (await advanced.isVisible().catch(() => false)) {
        const open = await advanced.getAttribute("open");
        if (open === null) {
          await advanced.locator("summary").click({ force: true });
        }
      }
    }

    const item = page.locator(".lm-review-redline-item").first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    // 上下文内联高亮：mark 只包改动字词，前后带基线上下文（非整段 mark）。
    await expect(item.locator(".lm-diff-remove")).toContainText("甲方应在");
    await expect(item.locator(".lm-diff-remove")).toContainText("内支付全部价款");
    await expect(item.locator(".lm-diff-remove mark")).toHaveText("三十");
    await expect(item.locator(".lm-diff-add mark")).toHaveText("十五");

    const resolveWait = page.waitForResponse(
      (res) =>
        res.url().includes("/api/drafts/e2e-draft-1/redline/hunks/e2e-hunk-1/resolve") &&
        res.request().method() === "POST",
    );
    await item.getByRole("button", { name: "接受", exact: true }).click();
    await resolveWait;
    await expect(page.getByText("暂无修订。")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/已处理 1 段/)).toBeVisible({ timeout: 10_000 });
  });

  test("改稿页可直接导出合同审阅稿（render-tracked）", async ({ page }) => {
    await gotoShell(page);
    await openReviewDraft(page);

    const trackedWait = page.waitForResponse(
      (res) =>
        res.url().includes("/api/drafts/e2e-draft-1/render-tracked") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /导出合同审阅稿/ }).first().click();
    await trackedWait;
    await expect(
      page.getByText(/审阅修订稿|e2e-draft-1-tracked|e2e-tracked|降级/).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("pending 草稿可删除并给出提示", async ({ page }) => {
    await gotoShell(page);
    // mock 状态跨用例共享（前一用例已通过签批）：先重置为「需修改」（可删态）。
    const reset = await page.request.post(`${e2eMockApiBase()}/api/drafts/e2e-draft-1/review`, {
      data: { status: "modified" },
    });
    expect(reset.ok()).toBe(true);
    await openReviewDraft(page);

    const deleteBtn = page.getByTestId("lm-review-delete-draft");
    await expect(deleteBtn).toBeVisible({ timeout: 30_000 });
    page.once("dialog", (dialog) => void dialog.accept());
    const deleteWait = page.waitForResponse(
      (res) =>
        res.url().includes("/api/drafts/e2e-draft-1") && res.request().method() === "DELETE",
    );
    await deleteBtn.click();
    await deleteWait;
    // 草稿列表回到空态（已删除的草稿不再出现在选择器与计数中）。
    await expect(page.getByRole("combobox", { name: "选择草稿" })).toBeDisabled({
      timeout: 15_000,
    });
    await expect(page.locator(".lm-review-draft-toolbar-count")).toHaveText("0/0", {
      timeout: 15_000,
    });
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

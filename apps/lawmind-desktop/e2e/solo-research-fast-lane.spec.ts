import { expect, test } from "@playwright/test";
import {
  e2eMockApiBase,
  gotoShell,
  installE2eBrowserPrefs,
  openDeskWork,
  openWorkspaceChat,
} from "./e2e-helpers";

/**
 * Solo 研究/培训快车道 + 大纲确认按钮路径。
 */
test.describe("Solo 研究培训快车道", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
    await page.addInitScript(() => {
      // Compliance dispatch requires compose allowWebSearch=true (not policy-blocked).
      localStorage.setItem("lawmind.ui.allowWebSearch", "1");
    });
    await page.request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });

  test("空态快车道→交办→大纲确认按钮→resume", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);

    await page.getByRole("button", { name: "新建对话" }).first().click();
    await expect(page.getByText("开始对话")).toBeVisible({ timeout: 20_000 });

    await openDeskWork(page);
    await page.getByTestId("lm-empty-open-research-fast-lane").click();
    await expect(page.getByTestId("lm-research-fast-lane")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("lm-research-lane-compliance").click();
    await page.getByTestId("lm-research-lane-topic").fill("跨境数据合规 E2E");
    await page.getByTestId("lm-research-lane-jurisdictions").fill("中国内地 / 欧盟");

    const chatWait = page.waitForResponse(
      (res) =>
        res.url().includes("/api/chat") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 30_000 },
    );
    await page.getByTestId("lm-research-lane-dispatch").click();
    await chatWait;

    await expect(page.getByRole("region", { name: "对话消息" })).toContainText(/研究大纲|确认/, {
      timeout: 20_000,
    });

    const outline = page.getByTestId("lm-outline-confirm");
    await expect(outline).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-outline-confirm-editor")).toBeVisible();

    await page.getByTestId("lm-outline-approve").click();
    await expect(page.getByTestId("lm-outline-decision")).toHaveAttribute("data-decision", "approved");

    const resumeWait = page.waitForResponse(
      (res) => res.url().includes("/api/chat/resume") && res.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.getByTestId("lm-clarify-submit").click();
    const res = await resumeWait;
    const body = res.request().postDataJSON() as {
      decision?: string;
      clarificationAnswers?: Record<string, string>;
    };
    expect(body.decision).toBe("respond");
    expect(body.clarificationAnswers?.research_outline_confirm).toMatch(/大纲已确认/);
  });

  test("填入对话框写入合规大纲文案", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await page.getByRole("button", { name: "新建对话" }).first().click();
    await expect(page.getByText("开始对话")).toBeVisible({ timeout: 20_000 });
    await openDeskWork(page);
    await page.getByTestId("lm-empty-open-research-fast-lane").click();
    await expect(page.getByTestId("lm-research-fast-lane")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("lm-research-lane-learning").click();
    await page.getByTestId("lm-research-lane-topic").fill("个人信息保护法速览");
    await page.getByTestId("lm-research-lane-fill").click();

    const composer = page.getByRole("textbox", { name: "消息输入" });
    await expect(composer).toHaveValue(/学习型调研简报/, { timeout: 10_000 });
    await expect(composer).toHaveValue(/个人信息保护法速览/);
    await expect(composer).toHaveValue(/大纲/);
    await expect(composer).toHaveValue(/交付物类型代码：report\.learning/);
  });

  test("合规快车道填入锁定类型代码与管辖区", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);
    await page.getByRole("button", { name: "新建对话" }).first().click();
    await expect(page.getByText("开始对话")).toBeVisible({ timeout: 20_000 });
    await openDeskWork(page);
    await page.getByTestId("lm-empty-open-research-fast-lane").click();
    await expect(page.getByTestId("lm-research-fast-lane")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("lm-research-lane-compliance").click();
    await page.getByTestId("lm-research-lane-topic").fill("新能源汽车出口");
    await page.getByTestId("lm-research-lane-jurisdictions").fill("中国内地 / 欧盟");
    await page.getByTestId("lm-research-lane-fill").click();

    const composer = page.getByRole("textbox", { name: "消息输入" });
    await expect(composer).toHaveValue(/交付物类型代码：report\.compliance/);
    await expect(composer).toHaveValue(/中国内地 \/ 欧盟/);
    await expect(composer).not.toHaveValue(/【可粘贴】/);
  });

  test("合规未填管辖区或关联网时禁用一键交办", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lawmind.ui.allowWebSearch", "0");
    });
    await gotoShell(page);
    await openWorkspaceChat(page);
    await page.getByRole("button", { name: "新建对话" }).first().click();
    await expect(page.getByText("开始对话")).toBeVisible({ timeout: 20_000 });
    await openDeskWork(page);
    await page.getByTestId("lm-empty-open-research-fast-lane").click();
    await expect(page.getByTestId("lm-research-fast-lane")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("lm-research-lane-compliance").click();
    await page.getByTestId("lm-research-lane-topic").fill("主题");
    // No jurisdictions → dispatch disabled
    await expect(page.getByTestId("lm-research-lane-dispatch")).toBeDisabled();
    // Fill still ok without jurisdictions? Plan: fill disabled when no jurisdictions too
    await expect(page.getByTestId("lm-research-lane-fill")).toBeDisabled();

    await page.getByTestId("lm-research-lane-jurisdictions").fill("中国内地 / 欧盟");
    // Web off → fill enabled, dispatch still disabled + readiness strip
    await expect(page.getByTestId("lm-research-lane-fill")).toBeEnabled();
    await expect(page.getByTestId("lm-research-lane-readiness")).toBeVisible();
    await expect(page.getByTestId("lm-research-lane-dispatch")).toBeDisabled();
  });
});

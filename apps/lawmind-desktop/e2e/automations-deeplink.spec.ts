import { expect, test, type Page } from "@playwright/test";
import { e2eMockApiBase, gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

async function openAutomationsPanel(page: Page): Promise<void> {
  await gotoShell(page);
  await page.getByRole("complementary").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "设置" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "搜索设置项" });
  await search.fill("自动办件");
  await search.press("Enter");
  await expect(page.getByTestId("lm-automations-panel")).toBeVisible({ timeout: 30_000 });
}

test.describe("自动办件：interval 创建与「查看流程」深链", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("interval 模式创建自动办件并出现在列表（含六确认真的进了请求体）", async ({ page }) => {
    await openAutomationsPanel(page);
    const preset = page.getByLabel("做什么");
    await expect(preset.locator("option", { hasText: "邮件合同审阅" })).toHaveCount(1);
    await preset.selectOption({ label: "邮件合同审阅" });
    await expect(page.getByTestId("lm-outbound-signoff-callout")).toBeVisible();
    await expect(page.getByTestId("lm-outbound-signoff-callout")).toContainText("签批审阅");
    await expect(page.getByLabel("多久一次")).toHaveValue("m30");
    await expect(page.getByLabel("选择案件")).not.toHaveValue("");

    // 规矩收在折叠里，默认已按模板写好。要改再打开。
    await page.getByTestId("lm-auto-more").locator("summary").click();
    await page.getByTestId("lm-auto-expected-result").fill("一份审阅意见：改了哪几处、依据哪一条");
    await page.getByTestId("lm-auto-approval-boundary").fill("外发前必须问我；不要自己改原稿");

    const createWait = page.waitForResponse(
      (res) => res.url().includes("/api/automations") && res.request().method() === "POST",
    );
    await page.getByTestId("lm-auto-create").click();
    const res = await createWait;
    const body = res.request().postDataJSON() as {
      presetId?: string;
      schedule?: { kind?: string; everyMinutes?: number };
      expectedResult?: string;
      approvalBoundary?: string;
    };
    expect(body.presetId).toBe("mail-contract-review");
    expect(body.schedule?.kind).toBe("interval");
    expect(body.schedule?.everyMinutes).toBeGreaterThanOrEqual(5);
    expect(body.expectedResult).toContain("审阅意见");
    expect(body.approvalBoundary).toContain("外发");

    // 列表出现新交办（scheduleLabel「每 N 分钟」）。
    await expect(
      page.locator(".lm-automations-list").getByText(/邮件合同审阅/).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".lm-automations-list").getByText(/每 \d+ 分钟/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("设置自动办件只含配置，不含待拍板结果", async ({ page }) => {
    await openAutomationsPanel(page);
    await expect(page.getByRole("heading", { name: "我的自动办件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "创建" })).toBeVisible();
    await expect(page.getByTestId("lm-mail-accounts")).toBeVisible();
    await expect(page.getByRole("heading", { name: "待拍板的运行结果" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "批准发送", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "已知悉", exact: true })).toHaveCount(0);
  });

  test("设置里的协作可以查看按流程办", async ({ page }) => {
    await gotoShell(page);
    await page.getByRole("complementary").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    const search = page.getByRole("searchbox", { name: "搜索设置项" });
    await search.fill("协作");
    await search.press("Enter");
    await expect(page.getByText("交出去的活和按流程办在这一页。")).toBeVisible({ timeout: 30_000 });
    const openFlow = page.getByRole("button", { name: "查看进度", exact: true }).first();
    await expect(openFlow).toBeVisible({ timeout: 30_000 });
    await openFlow.click();

    await expect(page.getByText(/1\/2|执行中|运行中/).first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("邮件合同审阅已完成（mock）：审阅稿已写入案件目录。"),
    ).toBeVisible({ timeout: 30_000 });
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });
});

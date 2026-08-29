import { expect, test, type Page } from "@playwright/test";
import {
  e2eMockApiBase,
  gotoShell,
  installE2eBrowserPrefs,
  openComposeOptions,
} from "./e2e-helpers";

/** 打开会议室并选择带编制（两名参会）的案件场次。 */
async function openMeetingWithMatter(page: Page): Promise<void> {
  await gotoShell(page);
  await openComposeOptions(page);
  await page.getByTestId("lm-compose-open-meeting").click();
  await expect(page.getByTestId("lm-meeting-view")).toBeVisible({ timeout: 30_000 });
  const matterGroup = page.getByTestId("lm-meeting-group-matter");
  if (await matterGroup.isVisible().catch(() => false)) {
    if ((await matterGroup.getAttribute("aria-expanded")) !== "true") {
      await matterGroup.click();
    }
  }
  const row = page.getByTestId("lm-meeting-scope-matter-e2e-matter-1");
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
}

test.describe("会议室全场", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("开始讨论 → 两名参会者发言进时间线 → 讨论结束", async ({ page }) => {
    await openMeetingWithMatter(page);
    await page.getByPlaceholder(/本案和解空间/).fill("供应商协议终止条款风险与和解空间");
    await page.getByRole("button", { name: "开始讨论", exact: true }).click();

    // 两名参会者依次发言（mock 即回）：默认助手与合同审查都出现在时间线。
    await expect(page.locator(".lm-matter-meeting-text").first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".lm-matter-meeting-author", { hasText: "默认助手" }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".lm-matter-meeting-author", { hasText: "合同审查" }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // 全场结束：回到 idle 并给出结束态文案。
    await expect(page.getByText(/讨论结束/).first()).toBeVisible({ timeout: 60_000 });
  });

  test("终止发言 → 暂停 → 继续讨论直至有产出", async ({ page }) => {
    await openMeetingWithMatter(page);
    await page.getByPlaceholder(/本案和解空间/).fill("e2e-slow 证据缺口与证人名单");
    await page.getByRole("button", { name: "开始讨论", exact: true }).click();

    await page.getByTestId("lm-meeting-interrupt").click();
    await expect(page.getByText(/已终止当前发言/).first()).toBeVisible({ timeout: 30_000 });

    const resume = page.getByRole("button", { name: "继续讨论", exact: true });
    await expect(resume).toBeVisible({ timeout: 15_000 });
    await resume.click();
    await expect(page.locator(".lm-matter-meeting-text").first()).toBeVisible({ timeout: 60_000 });
  });

  test.afterAll(async ({ request }) => {
    // 会议时间线与助手列表为共享 mock 状态，结束后复位。
    await request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });
});

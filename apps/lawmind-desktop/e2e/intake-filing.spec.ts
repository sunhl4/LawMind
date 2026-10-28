import { expect, test, type Page } from "@playwright/test";
import {
  e2eMockApiBase,
  e2eScopeHeaders,
  gotoShell,
  installE2eBrowserPrefs,
  openDeskTab,
} from "./e2e-helpers";

/**
 * 待归案的桌面闭环（P0.4 验收门里的那条端到端）。
 *
 * 待归案落在**工作台**（今日提醒上方），不新增一级页面：
 * 交办册「在办」主体已于 2026-09-30 并入工作台，⌘K 的「在办」不再是唯一入口。
 *
 * 断言的落点：
 * 1. 来件出现在工作台「待归案」，状态是待归案，不是签批；
 * 2. 详情给得出原文、附件、认证结论，以及「没有命中任何在办案件」；
 * 3. 「归入案件」真的把 matterId 与「记住发件人」带到服务端，并让这一行离开列表；
 * 4. 「进入收案」必须律师自己填名称，服务端收到的是 `accepted` 线索。
 *
 * mock 的待归案状态按作用域隔离且缺省为空，所以这条 spec 不会改变其它套件的首屏。
 */

const ITEM_ID = "it-e2e00001";

async function seedIntake(page: Page, scopeId: string): Promise<void> {
  const res = await page.request.post(`${e2eMockApiBase()}/__e2e__/intake`, {
    headers: e2eScopeHeaders(scopeId),
    data: { seed: true },
  });
  expect(res.ok()).toBe(true);
}

async function readIntakeState(page: Page, scopeId: string) {
  const res = await page.request.get(`${e2eMockApiBase()}/__e2e__/intake`, {
    headers: e2eScopeHeaders(scopeId),
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as {
    items: Array<{ id: string; status: string; lead?: { stage?: string } }>;
    attached: Array<{
      id: string;
      matterId?: string;
      rememberSender?: boolean;
      leadStage?: string | null;
    }>;
  };
}

async function openIntakeInbox(page: Page): Promise<void> {
  await gotoShell(page);
  await openDeskTab(page);
  const inbox = page.getByTestId("lm-intake-inbox");
  await expect(inbox).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`lm-intake-row-${ITEM_ID}`).click();
  await expect(page.getByTestId("lm-fleet-intake-detail")).toBeVisible({ timeout: 20_000 });
}

test.describe("待归案来件", () => {
  let scopeId = "";

  test.beforeEach(async ({ page }) => {
    ({ scopeId } = await installE2eBrowserPrefs(page));
  });

  test.afterEach(async ({ page }) => {
    await page.request.post(`${e2eMockApiBase()}/__e2e__/intake`, {
      headers: e2eScopeHeaders(scopeId),
      data: { seed: false },
    });
  });

  test("律师核对原文与线索后归入案件，并记住发件人", async ({ page }) => {
    await seedIntake(page, scopeId);
    await openIntakeInbox(page);

    const inbox = page.getByTestId("lm-intake-inbox");
    await expect(inbox).toContainText("收件里还有 1 封没归案");
    await expect(inbox).toContainText("买卖合同纠纷咨询");

    const detail = page.getByTestId("lm-fleet-intake-detail");
    await expect(detail).toContainText("王五");
    await expect(detail).toContainText("发件域认证通过");
    await expect(detail).toContainText("没有命中任何在办案件");
    await expect(detail).toContainText("送货单.pdf");
    await expect(detail).toContainText("我们有一批货被对方拒收");
    // 待归案不是签批：不出现签批按钮。
    await expect(inbox.getByText("签批", { exact: true })).toHaveCount(0);

    const attach = page.getByTestId("lm-intake-attach");
    await expect(attach).toBeDisabled();
    await page.getByTestId("lm-fleet-intake-matter-select").selectOption("e2e-matter-1");
    await expect(attach).toBeEnabled();
    await page.getByTestId("lm-fleet-intake-remember-sender").check();
    await attach.click();

    await expect(page.getByTestId("lm-intake-inbox")).toHaveCount(0, { timeout: 20_000 });
    const state = await readIntakeState(page, scopeId);
    expect(state.attached).toContainEqual({
      id: ITEM_ID,
      matterId: "e2e-matter-1",
      rememberSender: true,
      leadStage: null,
    });
  });

  test("律师把没有候选的来件进成新案线索：先填名称再进入收案", async ({ page }) => {
    await seedIntake(page, scopeId);
    await openIntakeInbox(page);

    const accept = page.getByTestId("lm-fleet-intake-lead-accept");
    await expect(accept).toBeDisabled();
    await page.getByTestId("lm-fleet-intake-lead-needs-info").click();
    const afterStage = await readIntakeState(page, scopeId);
    expect(afterStage.items[0]?.lead?.stage).toBe("needs_info");
    // 待补资料不离开列表。
    await expect(page.getByTestId(`lm-intake-row-${ITEM_ID}`)).toBeVisible();

    await page.getByTestId("lm-fleet-intake-lead-title").fill("王五买卖合同纠纷");
    await expect(accept).toBeEnabled();
    await accept.click();

    await expect(page.getByTestId("lm-intake-inbox")).toHaveCount(0, { timeout: 20_000 });
    const state = await readIntakeState(page, scopeId);
    expect(state.attached).toContainEqual({
      id: ITEM_ID,
      matterId: "王五买卖合同纠纷",
      rememberSender: false,
      leadStage: "accepted",
    });
  });
});

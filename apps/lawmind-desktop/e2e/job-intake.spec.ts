import { expect, test } from "@playwright/test";
import {
  assertReviewGateList,
  e2eMockApiBase,
  gotoShell,
  installE2eBrowserPrefs,
} from "./e2e-helpers";

test.describe("Job intake & template gallery", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("compose gallery form-first fills 【交办】 prompt", async ({ page }) => {
    await gotoShell(page);

    await page.getByTestId("lm-compose-write-materials").click();
    const gallery = page.getByRole("dialog", { name: /写文稿|做材料/i });
    await expect(gallery).toBeVisible({ timeout: 15_000 });

    const fillBtn = gallery.getByRole("button", { name: "填表交办" }).first();
    if (!(await fillBtn.isVisible().catch(() => false))) {
      test.skip(true, "mock API returned no workflow templates");
      return;
    }
    await fillBtn.click();
    await expect(gallery.getByTestId("lm-job-intake-submit")).toBeVisible({ timeout: 10_000 });

    // Fill required fields loosely: type into first visible text inputs/textareas.
    const fields = gallery.locator(".lm-job-intake-field input, .lm-job-intake-field textarea");
    const count = await fields.count();
    for (let i = 0; i < count; i++) {
      await fields.nth(i).fill(`e2e-field-${i}`);
    }

    const fillComposer = gallery.getByRole("button", { name: /填入对话/ });
    await fillComposer.click();
    await expect(gallery).toBeHidden({ timeout: 10_000 });
    const compose = page.getByRole("textbox", { name: /消息输入/i });
    await expect(compose).toHaveValue(/【交办】/, { timeout: 10_000 });
  });

  test("intake triage confirm path fills composer", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-compose-write-materials").click();
    const gallery = page.getByRole("dialog", { name: /写文稿|做材料/i });
    await expect(gallery).toBeVisible({ timeout: 15_000 });
    const fillBtn = gallery.getByRole("button", { name: "填表交办" }).first();
    if (!(await fillBtn.isVisible().catch(() => false))) {
      test.skip(true, "mock API returned no workflow templates");
      return;
    }
    await fillBtn.click();
    const fields = gallery.locator(".lm-job-intake-field input, .lm-job-intake-field textarea");
    const count = await fields.count();
    for (let i = 0; i < count; i++) {
      await fields.nth(i).fill(`e2e-triage-${i}`);
    }
    await gallery.getByTestId("lm-job-intake-submit").click();
    await expect(gallery.getByTestId("lm-triage-tier")).toBeVisible({ timeout: 10_000 });
    await expect(gallery.getByTestId("lm-triage-upgrade-full")).toBeVisible();
    await gallery.getByTestId("lm-triage-confirm").click();
    // 「确认并执行」走 onDispatch：消息进入对话区，而非仅填入输入框。
    await expect(gallery).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole("region", { name: "对话消息" })).toContainText(/【交办】/, {
      timeout: 15_000,
    });
  });

  test("golden journey: 填表交办 → 文书台 → 验收门禁可见", async ({ page }) => {
    await gotoShell(page);

    await page.getByTestId("lm-compose-write-materials").click();
    const gallery = page.getByRole("dialog", { name: /写文稿|做材料/i });
    await expect(gallery).toBeVisible({ timeout: 15_000 });
    const fillBtn = gallery.getByRole("button", { name: "填表交办" }).first();
    if (!(await fillBtn.isVisible().catch(() => false))) {
      test.skip(true, "mock API returned no workflow templates");
      return;
    }
    await fillBtn.click();
    const fields = gallery.locator(".lm-job-intake-field input, .lm-job-intake-field textarea");
    const count = await fields.count();
    for (let i = 0; i < count; i++) {
      await fields.nth(i).fill(`e2e-golden-${i}`);
    }
    await gallery.getByRole("button", { name: /填入对话/ }).click();
    await expect(page.getByRole("textbox", { name: /消息输入/i })).toHaveValue(/【交办】/, {
      timeout: 10_000,
    });

    // assertReviewGateList opens 文书台 and waits for draft detail (do not open twice).
    await assertReviewGateList(page);
    await expect(page.getByText(/验收|acceptance|门禁/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("first-run prefs step is reachable when dismiss key cleared", async ({ page }) => {
    await page.route(`${e2eMockApiBase()}/api/matters/overviews**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, overviews: [] }),
      });
    });
    await page.addInitScript(() => {
      localStorage.removeItem("lm.firstRun.dismissed");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 60_000 });
    const firstRun = page.getByRole("dialog", { name: /LawMind 新手引导/i });
    if (!(await firstRun.isVisible({ timeout: 12_000 }).catch(() => false))) {
      test.skip(true, "first-run suppressed (API wizard or model not ready)");
      return;
    }
    await firstRun.getByRole("button", { name: /独立执业|律所协办|合伙人/ }).first().click();
    await expect(firstRun.getByText(/行文风格|风险口径|对客语气/).first()).toBeVisible({
      timeout: 10_000,
    });
    await firstRun.getByRole("button", { name: /稍后再说|不用了/ }).first().click();
  });
});

import { expect, test } from "@playwright/test";

test.describe("LawMind renderer smoke", () => {
  test("loads shell with LawMind brand", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/LawMind/);
    await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".lm-brand-title")).toHaveText("LawMind");
    await expect(page.getByText("Legal Workbench")).toBeVisible();
  });

  test("shows default assistant in main title area", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".lm-main-title")).toContainText("默认助手", { timeout: 60_000 });
  });
});

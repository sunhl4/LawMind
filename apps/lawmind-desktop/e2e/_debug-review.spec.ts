/**
 * Quarantined local debug harness (excluded via playwright.config testIgnore).
 * Do not add to lawmind:desktop:e2e:pr.
 */
import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test("debug open review", async ({ page }) => {
  await installE2eBrowserPrefs(page);
  await gotoShell(page);
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  await mainNav.getByRole("button", { name: "在办", exact: true }).click();
  await expect(page.locator(".lm-agent-fleet-page")).toBeVisible({ timeout: 30_000 });
  const openWorkbench = page
    .getByTestId("lm-fleet-primary-review")
    .or(page.getByRole("button", { name: /进入文书台/ }))
    .first();
  console.log("btn text", await openWorkbench.innerText());
  console.log("btn testid", await openWorkbench.getAttribute("data-testid"));
  await openWorkbench.click();
  await page.waitForTimeout(2000);
  console.log("mainView hint", await page.locator(".lm-review-workbench-root, .lm-agent-fleet-page").evaluateAll(els => els.map(e => e.className)));
  console.log("url", page.url());
  console.log("has review", await page.locator(".lm-review-workbench-root").count());
  console.log("aria", await page.locator("main").innerText().then(t => t.slice(0, 400)));
});

import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

test.describe("Skills library + CN pack (S5)", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("settings skills shows CN pack and rejects bad signature skill", async ({ page }) => {
    await gotoShell(page);
    await page.getByRole("complementary").getByRole("button", { name: "设置" }).click({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "设置" })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "搜索设置项" });
    await search.fill("技能");
    await search.press("Enter");
    await expect(page.getByTestId("lm-settings-skills")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-cn-legal-pack")).toBeVisible();
    await expect(page.getByTestId("lm-skill-row-tampered-skill")).toBeVisible();
    await expect(page.getByTestId("lm-skill-toggle-tampered-skill")).toHaveText(/拒载/);
    await expect(page.getByTestId("lm-skill-toggle-tampered-skill")).toBeDisabled();
  });
});

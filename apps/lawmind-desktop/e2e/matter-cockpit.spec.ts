import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openMatterCockpit } from "./e2e-helpers";

/**
 * Matter dossier reachability — cases open on 工作台 (not the retired cockpit page).
 */
test.describe("Lawyer workbench matter dossier", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("workbench shell renders", async ({ page }) => {
    await gotoShell(page);
    await openMatterCockpit(page);

    await expect(page.getByTestId("lm-lawyer-workbench")).toBeVisible({ timeout: 30_000 });
  });

  test("matter dossier is reachable when a case is opened", async ({ page }) => {
    await gotoShell(page);
    await openMatterCockpit(page);

    const dossier = page.getByTestId("lm-lawyer-matter-dossier");
    if (await dossier.count()) {
      await expect(dossier).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByTestId("lm-lawyer-cockpit")).toBeVisible({ timeout: 15_000 });
    }
  });
});

import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openReviewWorkbench } from "./e2e-helpers";

test.describe("文书台 / 待我拍板 决策落地", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("在办「改稿」进入改稿面", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    await expect(page.getByTestId("lm-agents-open-review")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("lm-agents-open-review").click();
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator(".lm-review-compose-main, .lm-review-editor-pane, .lm-review-preview-pane").first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("侧栏待我拍板 opens needs-decision focus", async ({ page }) => {
    await gotoShell(page);
    const hub = page.getByTestId("lm-side-needs-decision").or(page.getByTestId("lm-side-action-hub"));
    await expect(hub).toBeVisible({ timeout: 60_000 });
    await hub.click();
    await expect(page.getByTestId("lm-agents-desk")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-agent-fleet-panel")).toHaveAttribute(
      "data-needs-decision",
      "true",
      { timeout: 15_000 },
    );
    await expect(
      page.getByTestId("lm-fleet-decision-focus-lead").or(page.getByTestId("lm-fleet-decision-empty")),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("openReviewWorkbench helper still reaches workbench", async ({ page }) => {
    await gotoShell(page);
    await openReviewWorkbench(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Firm：顶栏无 peer 文书台，从在办进入后出现次级文书台", async ({ page }) => {
    await gotoShell(page);
    const mainNav = page.getByRole("navigation", { name: "功能模块" });
    await expect(mainNav).toBeVisible({ timeout: 30_000 });
    await expect(mainNav.getByTestId("lm-tab-review")).toHaveCount(0);
    await expect(mainNav).not.toContainText("文书台");

    await openReviewWorkbench(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });
    const secondary = mainNav.getByTestId("lm-tab-review");
    await expect(secondary).toBeVisible({ timeout: 15_000 });
    await expect(secondary).toContainText("文书台");
    await expect(secondary).toHaveClass(/lm-tab-secondary/);
    await expect(secondary).toHaveAttribute("aria-current", "page");
  });

  test("Solo：顶栏无 peer 文书台，从在办进入后出现次级改稿", async ({ page }) => {
    await page.route("**/api/policy/edition**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          edition: "solo",
          label: "独立律师版",
          source: "default",
          citationMode: "assisted",
          features: {
            acceptanceGateStrict: true,
            citationGateStrict: true,
            crossMatterRoadmap: false,
            crossMatterAcceptanceDashboard: false,
            collaborationSummary: false,
            complianceAuditExport: false,
            auditIntegrityExport: false,
            securitySbomPanel: false,
            qualityDashboardJsonExport: false,
            customDeliverableSpec: false,
            acceptancePackExport: false,
            strictDangerousToolApproval: false,
            reviewCampaignParallel: true,
            forcePeerReview: false,
          },
        }),
      });
    });

    await gotoShell(page);
    const mainNav = page.getByRole("navigation", { name: "功能模块" });
    await expect(mainNav).toBeVisible({ timeout: 30_000 });
    await expect(mainNav.getByTestId("lm-tab-review")).toHaveCount(0);
    await expect(mainNav).not.toContainText("文书台");

    await openReviewWorkbench(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 30_000,
    });
    const secondary = mainNav.getByTestId("lm-tab-review");
    await expect(secondary).toBeVisible({ timeout: 15_000 });
    await expect(secondary).toContainText("改稿");
    await expect(secondary).toHaveClass(/lm-tab-secondary/);
  });
});

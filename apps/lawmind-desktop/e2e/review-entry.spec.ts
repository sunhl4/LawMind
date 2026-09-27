import { expect, test } from "@playwright/test";
import { gotoShell, installE2eBrowserPrefs, openReviewWorkbench } from "./e2e-helpers";

test.describe("文书台 / 待我拍板 决策落地", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("在办「看修订」回到对话，不打开改稿台", async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId("lm-tab-agents").click();
    const openRevision = page.getByTestId("lm-agents-open-review");
    await expect(openRevision).toHaveText("看修订", { timeout: 30_000 });
    await openRevision.click();
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench")).toHaveCount(0);
    await expect(
      page.locator("#lawmind-chat-messages-panel").or(page.getByRole("region", { name: "对话消息" })).first(),
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

  test("看修订 helper 回到对话", async ({ page }) => {
    await gotoShell(page);
    await openReviewWorkbench(page);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench")).toHaveCount(0);
  });

  test("Firm：看修订之后顶栏仍没有改稿", async ({ page }) => {
    await gotoShell(page);
    const mainNav = page.getByRole("navigation", { name: "功能模块" });
    await expect(mainNav).toBeVisible({ timeout: 30_000 });
    await expect(mainNav.getByTestId("lm-tab-review")).toHaveCount(0);
    await expect(mainNav).not.toContainText("文书台");

    await openReviewWorkbench(page);
    await expect(mainNav.getByTestId("lm-tab-review")).toHaveCount(0);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench")).toHaveCount(0);
  });

  test("Solo：看修订之后顶栏仍没有改稿", async ({ page }) => {
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
            crossMatterRoadmap: true,
            crossMatterAcceptanceDashboard: true,
            complianceAuditExport: false,
            auditIntegrityExport: true,
            securitySbomPanel: false,
            qualityDashboardJsonExport: true,
            customDeliverableSpec: true,
            acceptancePackExport: true,
            strictDangerousToolApproval: false,
            reviewCampaignParallel: true,
            forcePeerReview: false,
            matterReplicaCollab: false,
            ethicsWall: false,
            wordAddinAutoRun: true,
            guardianTrackedRedlineBlock: false,
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
    await expect(mainNav.getByTestId("lm-tab-review")).toHaveCount(0);
    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench")).toHaveCount(0);
  });
});

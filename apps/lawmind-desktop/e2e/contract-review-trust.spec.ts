import { expect, test } from "@playwright/test";
import { e2eMockApiBase, gotoShell, installE2eBrowserPrefs } from "./e2e-helpers";

/**
 * Contract review trust flow — review matrix + acceptance/reasoning gates (mock API).
 */
test.describe("Contract review trust flow", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
  });

  test("review matrix API is reachable from matter workbench context", async ({ page }) => {
    await gotoShell(page);
    const matrixRes = await page.request.get(
      `${e2eMockApiBase()}/api/matters/review-matrix?matterId=e2e-matter-1`,
    );
    expect(matrixRes.ok()).toBe(true);
    const body = (await matrixRes.json()) as {
      matrix?: { cells?: unknown[]; documents?: unknown[] };
    };
    expect(body.matrix?.documents?.length).toBeGreaterThan(0);
    expect(body.matrix?.cells?.length).toBeGreaterThan(0);
  });

  test("draft detail exposes acceptance and reasoning gate metadata", async ({ page }) => {
    await gotoShell(page);
    const draftRes = await page.request.get(`${e2eMockApiBase()}/api/drafts/e2e-draft-1`);
    expect(draftRes.ok()).toBe(true);
    const body = (await draftRes.json()) as {
      acceptance?: { deliverableType?: string };
      reasoningReport?: { required?: boolean };
      gateDecisions?: { gate: string }[];
    };
    expect(body.acceptance?.deliverableType).toBe("contract.review");
    expect(body.reasoningReport?.required).toBe(true);
    expect(body.gateDecisions?.some((g) => g.gate === "acceptance_gate")).toBe(true);
    expect(body.gateDecisions?.some((g) => g.gate === "reasoning_gate")).toBe(true);
  });

  test("session-timeline returns events for matter", async ({ page }) => {
    await gotoShell(page);
    const res = await page.request.get(
      `${e2eMockApiBase()}/api/matters/session-timeline?matterId=e2e-matter-1`,
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { entries?: unknown[] };
    expect((body.entries ?? []).length).toBeGreaterThan(0);
  });

  test("render-tracked mock endpoint returns output path", async ({ page }) => {
    await gotoShell(page);
    const res = await page.request.post(
      `${e2eMockApiBase()}/api/drafts/e2e-draft-1/render-tracked`,
      { data: {} },
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { outputPath?: string };
    expect(body.outputPath).toContain("e2e-tracked");
  });
});

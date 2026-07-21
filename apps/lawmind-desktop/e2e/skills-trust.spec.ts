import { expect, test } from "@playwright/test";
import { e2eMockApiBase } from "./e2e-helpers";

test.describe("Skills trust gates (G1 leftovers)", () => {
  test("必核未勾完时 approve 返回 422", async ({ request }) => {
    const base = e2eMockApiBase();
    const res = await request.post(`${base}/api/drafts/task-1/review`, {
      data: { status: "approved", checklistChecked: { parties: true } },
    });
    expect(res.status()).toBe(422);
    const body = (await res.json()) as { error?: string; missingRequiredIds?: string[] };
    expect(body.error).toBe("checklist_incomplete");
    expect(body.missingRequiredIds?.length).toBeGreaterThan(0);
  });

  test("grounded render without theory anchor returns 422 via API", async ({ request }) => {
    const base = e2eMockApiBase();
    const res = await request.post(`${base}/api/drafts/task-1/render`, {
      data: { citationMode: "grounded", forceGroundedBlock: true },
    });
    expect(res.status()).toBe(422);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toBe("theory_not_anchored");
  });
});

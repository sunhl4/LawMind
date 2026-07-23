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

  test("team-growth metrics snapshot + baseline via mock API", async ({ request }) => {
    const base = e2eMockApiBase();
    const getRes = await request.get(`${base}/api/metrics/team-growth?windowDays=14`);
    expect(getRes.status()).toBe(200);
    const snap = (await getRes.json()) as {
      ok?: boolean;
      windowDays?: number;
      metrics?: Array<{ id: string }>;
    };
    expect(snap.ok).toBe(true);
    expect(snap.windowDays).toBe(14);
    expect(snap.metrics?.some((m) => m.id === "first_pass_rate")).toBe(true);

    const postRes = await request.post(`${base}/api/metrics/team-growth/baseline`, {
      data: { windowDays: 14, note: "e2e" },
    });
    expect(postRes.status()).toBe(200);
    const baselined = (await postRes.json()) as {
      ok?: boolean;
      baseline?: { note?: string };
    };
    expect(baselined.ok).toBe(true);
    expect(baselined.baseline?.note).toBe("e2e");
  });
});

import { expect, test } from "@playwright/test";
import { e2eMockApiBase } from "./e2e-helpers";

test.describe("NDA triage (G1)", () => {
  test("API preview for NDA text hits nda-yellow", async ({ request }) => {
    const base = e2eMockApiBase();
    const res = await request.post(`${base}/api/triage`, {
      data: { text: "请审查双方 NDA 保密协议条款", deliverableTypeHint: "contract.nda" },
    });
    expect(res.ok()).toBeTruthy();
    const j = (await res.json()) as {
      session?: { result?: { matchedRuleIds?: string[]; recommendedWorkflowId?: string; clarifications?: unknown[] } };
    };
    expect(j.session?.result?.matchedRuleIds).toContain("nda-yellow");
    expect(j.session?.result?.recommendedWorkflowId).toBe("nda-triage");
    expect(j.session?.result?.clarifications?.length).toBeGreaterThan(0);
  });
});

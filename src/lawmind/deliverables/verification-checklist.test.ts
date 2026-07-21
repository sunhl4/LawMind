import { describe, expect, it } from "vitest";
import {
  assertChecklistCompleteForApprove,
  buildChecklistView,
  resolveVerificationChecklistSpec,
} from "./verification-checklist.js";

describe("verification-checklist", () => {
  it("resolves contract review spec", () => {
    const s = resolveVerificationChecklistSpec("contract.review");
    expect(s.id).toBe("contract-review-v1");
    expect(s.items.some((i) => i.id === "liability")).toBe(true);
  });

  it("blocks approve when required unchecked", () => {
    const view = buildChecklistView("letter.demand", null);
    expect(view.complete).toBe(false);
    expect(() => assertChecklistCompleteForApprove(view)).toThrow(/checklist_incomplete/);
  });

  it("passes when all required checked", () => {
    const view0 = buildChecklistView("letter.demand", null);
    const checked = Object.fromEntries(view0.spec.items.map((i) => [i.id, i.required]));
    const view = buildChecklistView("letter.demand", { specId: view0.spec.id, checked });
    expect(view.complete).toBe(true);
    expect(() => assertChecklistCompleteForApprove(view)).not.toThrow();
  });
});

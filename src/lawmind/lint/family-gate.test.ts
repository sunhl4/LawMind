import { describe, expect, it } from "vitest";
import { familyDeliverableMatches } from "./family-gate.js";

describe("familyDeliverableMatches", () => {
  it("does not run family rules when deliverableType is missing", () => {
    expect(familyDeliverableMatches("loan")).toBe(false);
    expect(familyDeliverableMatches("sale", {})).toBe(false);
    expect(familyDeliverableMatches("employment", { deliverableType: "  " })).toBe(false);
  });

  it("requires the type to be in the family set", () => {
    expect(familyDeliverableMatches("loan", { deliverableType: "contract.review" })).toBe(true);
    expect(familyDeliverableMatches("loan", { deliverableType: "memo.opinion" })).toBe(false);
    expect(familyDeliverableMatches("lease", { deliverableType: "contract.rental" })).toBe(true);
  });
});

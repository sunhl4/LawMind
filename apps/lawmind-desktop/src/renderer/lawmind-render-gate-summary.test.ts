import { describe, expect, it } from "vitest";
import { buildRenderGateSummary } from "./lawmind-render-gate-summary";

describe("buildRenderGateSummary", () => {
  it("requires approval first", () => {
    expect(
      buildRenderGateSummary({
        reviewStatus: "pending",
        acceptance: null,
      }),
    ).toContain("签批");
  });

  it("lists acceptance blockers when approved but not ready", () => {
    expect(
      buildRenderGateSummary({
        reviewStatus: "approved",
        acceptance: {
          deliverableType: "contract.general",
          ready: false,
          blockerCount: 2,
          warningCount: 1,
        } as never,
      }),
    ).toContain("出稿检查");
  });
});

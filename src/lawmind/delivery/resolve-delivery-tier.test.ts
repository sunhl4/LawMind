import { describe, expect, it } from "vitest";
import { resolveDeliveryTier, resolveFirmForceFullReview } from "./resolve-delivery-tier.js";
import type { DeliveryTier, ResolveDeliveryTierInput } from "./types.js";

function tier(
  partial: Partial<ResolveDeliveryTierInput> & Pick<ResolveDeliveryTierInput, "riskLevel">,
): DeliveryTier {
  return resolveDeliveryTier({
    outbound: false,
    autonomyUnlocked: false,
    ...partial,
  });
}

describe("resolveDeliveryTier", () => {
  it("never auto-delivers outbound, even when autonomy is unlocked and risk is low", () => {
    expect(
      resolveDeliveryTier({
        riskLevel: "low",
        outbound: true,
        autonomyUnlocked: true,
        edition: "solo",
      }),
    ).toBe("one_tap_signoff");
    expect(
      resolveDeliveryTier({
        riskLevel: "medium",
        outbound: true,
        autonomyUnlocked: true,
      }),
    ).toBe("one_tap_signoff");
  });

  it("keeps outbound high as full_review (signoff floor, not a downgrade)", () => {
    expect(
      resolveDeliveryTier({
        riskLevel: "high",
        outbound: true,
        autonomyUnlocked: true,
        edition: "solo",
      }),
    ).toBe("full_review");
  });

  it("maps firm high and any high to full_review", () => {
    expect(tier({ riskLevel: "high", edition: "firm", autonomyUnlocked: true })).toBe(
      "full_review",
    );
    expect(tier({ riskLevel: "high", edition: "solo" })).toBe("full_review");
    expect(tier({ riskLevel: "high", edition: "private_deploy" })).toBe("full_review");
  });

  it("honors firmForceFullReview even on low internal drafts", () => {
    expect(
      resolveDeliveryTier({
        riskLevel: "low",
        outbound: false,
        autonomyUnlocked: true,
        firmForceFullReview: true,
      }),
    ).toBe("full_review");
    expect(resolveFirmForceFullReview({ delivery: { firmForceFullReview: true } })).toBe(true);
    expect(resolveFirmForceFullReview({ delivery: {} })).toBe(false);
    expect(resolveFirmForceFullReview(null)).toBe(false);
  });

  it("maps medium to one_tap_signoff (unlocked does not auto-deliver)", () => {
    expect(
      resolveDeliveryTier({
        riskLevel: "medium",
        outbound: false,
        autonomyUnlocked: true,
        edition: "solo",
      }),
    ).toBe("one_tap_signoff");
    expect(
      resolveDeliveryTier({
        riskLevel: "medium",
        outbound: false,
        autonomyUnlocked: true,
        edition: "firm",
      }),
    ).toBe("one_tap_signoff");
  });

  it("auto-delivers only low + unlocked + not outbound", () => {
    expect(
      resolveDeliveryTier({
        riskLevel: "low",
        outbound: false,
        autonomyUnlocked: true,
      }),
    ).toBe("auto_deliver");
    expect(
      resolveDeliveryTier({
        riskLevel: "low",
        outbound: false,
        autonomyUnlocked: false,
      }),
    ).toBe("one_tap_signoff");
  });

  it("ignores audience when outbound is explicit", () => {
    expect(
      resolveDeliveryTier({
        riskLevel: "low",
        audience: "客户",
        outbound: false,
        autonomyUnlocked: true,
      }),
    ).toBe("auto_deliver");
    expect(
      resolveDeliveryTier({
        riskLevel: "low",
        audience: "内部",
        outbound: true,
        autonomyUnlocked: true,
      }),
    ).toBe("one_tap_signoff");
  });

  it("covers the conservative default matrix", () => {
    const rows: Array<[ResolveDeliveryTierInput, DeliveryTier]> = [
      [
        { riskLevel: "low", outbound: false, autonomyUnlocked: false, edition: "solo" },
        "one_tap_signoff",
      ],
      [
        { riskLevel: "low", outbound: false, autonomyUnlocked: true, edition: "solo" },
        "auto_deliver",
      ],
      [
        { riskLevel: "low", outbound: true, autonomyUnlocked: true, edition: "solo" },
        "one_tap_signoff",
      ],
      [
        { riskLevel: "medium", outbound: false, autonomyUnlocked: true, edition: "solo" },
        "one_tap_signoff",
      ],
      [
        { riskLevel: "medium", outbound: true, autonomyUnlocked: false, edition: "firm" },
        "one_tap_signoff",
      ],
      [
        { riskLevel: "high", outbound: false, autonomyUnlocked: true, edition: "solo" },
        "full_review",
      ],
      [
        { riskLevel: "high", outbound: false, autonomyUnlocked: true, edition: "firm" },
        "full_review",
      ],
      [
        { riskLevel: "high", outbound: true, autonomyUnlocked: true, edition: "firm" },
        "full_review",
      ],
      [
        {
          riskLevel: "low",
          outbound: false,
          autonomyUnlocked: true,
          edition: "firm",
          firmForceFullReview: true,
        },
        "full_review",
      ],
    ];
    for (const [input, expected] of rows) {
      expect(resolveDeliveryTier(input), JSON.stringify(input)).toBe(expected);
    }
  });
});

import type { DeliveryTier, ResolveDeliveryTierInput } from "./types.js";

/**
 * Conservative delivery tier. Outbound never auto-delivers.
 * high / firmForceFullReview → full_review. medium → one_tap_signoff.
 * auto_deliver only for low + unlocked + not outbound.
 */
export function resolveDeliveryTier(input: ResolveDeliveryTierInput): DeliveryTier {
  const { riskLevel, outbound, autonomyUnlocked, firmForceFullReview } = input;

  if (firmForceFullReview === true) {
    return "full_review";
  }
  if (riskLevel === "high") {
    return "full_review";
  }

  if (outbound) {
    return "one_tap_signoff";
  }
  if (riskLevel === "medium") {
    return "one_tap_signoff";
  }

  if (riskLevel === "low" && !outbound && autonomyUnlocked) {
    return "auto_deliver";
  }
  return "one_tap_signoff";
}

export function resolveFirmForceFullReview(
  policy?: { delivery?: { firmForceFullReview?: boolean } } | null,
): boolean {
  return policy?.delivery?.firmForceFullReview === true;
}

import type { DeliveryTier, ResolveDeliveryTierInput } from "./types.js";

/**
 * Conservative delivery tier. Outbound never auto-delivers.
 * high / firmForceFullReview → full_review. medium → one_tap_signoff.
 * auto_deliver only for low + unlocked + not outbound.
 */
export function resolveDeliveryTier(input: ResolveDeliveryTierInput): DeliveryTier {
  const { riskLevel, outbound, autonomyUnlocked, firmForceFullReview, playbook } = input;

  if (firmForceFullReview === true) {
    return "full_review";
  }
  // 只有加载了本所剧本的结论才改档位；`basis=default` 只影响依据展示。
  const playbookVerdict = playbook?.basis === "playbook" ? playbook.verdict : undefined;
  if (playbookVerdict === "RED") {
    return "full_review";
  }
  if (riskLevel === "high") {
    return "full_review";
  }

  if (outbound) {
    return "one_tap_signoff";
  }
  // 剧本跑过（GREEN 或 YELLOW）就封顶到一键签发：RED 已在上方拦下，
  // GREEN 也不自动交付——「全部条件有据通过」仍要律师点一次。
  if (playbookVerdict) {
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

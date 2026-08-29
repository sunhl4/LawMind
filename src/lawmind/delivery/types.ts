/**
 * W2-3: tiered delivery, progressive autonomy, and lawyer-facing decision headers.
 * Policy keys are optional; omitted values stay conservative (outbound never auto-delivers).
 */

export type DeliveryTier = "auto_deliver" | "one_tap_signoff" | "full_review";

export type DeliveryRiskLevel = "low" | "medium" | "high";

export type DeliveryEdition = "solo" | "firm" | "private_deploy";

export type DeliveryReady = "usable" | "needs_decision";

export type DecisionHeader = {
  /** 改了什么 */
  changed: string;
  /** 为什么 */
  why: string;
  /** 风险 */
  risk: string;
  ready: DeliveryReady;
};

/** Optional workspace-policy.delivery */
export type DeliveryPolicy = {
  description?: string;
  /**
   * When true, every draft is full_review.
   * Default: medium → one_tap_signoff; high → full_review;
   * auto_deliver only if autonomy unlocked AND low AND not outbound.
   */
  firmForceFullReview?: boolean;
};

/** Optional workspace-policy.progressiveAutonomy */
export type ProgressiveAutonomyPolicy = {
  description?: string;
  /** Default 0.8 */
  minFirstPassRate?: number;
  /** Default 20 */
  minSamples?: number;
  /** Default 0.15 */
  maxLintEscapeRate?: number;
};

export const DEFAULT_PROGRESSIVE_AUTONOMY = {
  minFirstPassRate: 0.8,
  minSamples: 20,
  maxLintEscapeRate: 0.15,
} as const;

export type ResolveDeliveryTierInput = {
  riskLevel: DeliveryRiskLevel;
  audience?: string;
  outbound: boolean;
  edition?: DeliveryEdition;
  autonomyUnlocked: boolean;
  firmForceFullReview?: boolean;
};

export type AutonomySeriesInput = {
  firstPassRate: number | null;
  firstPassSamples: number;
  /** Null = lint-escape series missing; do not unlock. */
  lintEscapeRate: number | null;
  /** Null = series missing; 0 = empty series. Both refuse unlock. */
  lintEscapeSamples: number | null;
  minFirstPassRate?: number;
  minSamples?: number;
  maxLintEscapeRate?: number;
};

/** Optional W2-2 self-revise summary (local shape; lint package stays untouched). */
export type SelfReviseSummary = {
  rounds?: number;
  appliedCount?: number;
  residualCount?: number;
  appliedSummaries?: string[];
  residualSummaries?: string[];
};

export function isDecisionHeader(value: unknown): value is DecisionHeader {
  if (!value || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.changed === "string" &&
    o.changed.trim().length > 0 &&
    typeof o.why === "string" &&
    o.why.trim().length > 0 &&
    typeof o.risk === "string" &&
    o.risk.trim().length > 0 &&
    (o.ready === "usable" || o.ready === "needs_decision")
  );
}

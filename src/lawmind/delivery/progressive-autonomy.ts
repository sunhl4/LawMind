import { DEFAULT_PROGRESSIVE_AUTONOMY, type AutonomySeriesInput } from "./types.js";

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Unlock progressive autonomy only when first-pass AND lint-escape series both qualify.
 * A rubber-stamp first-pass series alone is not enough.
 */
export function isAutonomyUnlocked(input: AutonomySeriesInput): boolean {
  const minFirstPassRate =
    finiteNumber(input.minFirstPassRate) ?? DEFAULT_PROGRESSIVE_AUTONOMY.minFirstPassRate;
  const minSamples = Math.max(
    0,
    Math.floor(finiteNumber(input.minSamples) ?? DEFAULT_PROGRESSIVE_AUTONOMY.minSamples),
  );
  const maxLintEscapeRate =
    finiteNumber(input.maxLintEscapeRate) ?? DEFAULT_PROGRESSIVE_AUTONOMY.maxLintEscapeRate;

  const firstPassRate = finiteNumber(input.firstPassRate);
  const firstPassSamples = Math.max(0, Math.floor(input.firstPassSamples));
  if (firstPassRate === null || firstPassSamples < minSamples || firstPassRate < minFirstPassRate) {
    return false;
  }

  // Missing series (null) or empty series (0) both refuse. Do not coerce null <= max.
  if (input.lintEscapeSamples === null || input.lintEscapeRate === null) {
    return false;
  }
  if (input.lintEscapeSamples === 0) {
    return false;
  }
  const lintEscapeRate = finiteNumber(input.lintEscapeRate);
  const lintEscapeSamples = Math.floor(input.lintEscapeSamples);
  if (lintEscapeRate === null || lintEscapeSamples < 1 || lintEscapeRate > maxLintEscapeRate) {
    return false;
  }
  return true;
}

export function resolveProgressiveAutonomyThresholds(
  policy?: {
    progressiveAutonomy?: {
      minFirstPassRate?: number;
      minSamples?: number;
      maxLintEscapeRate?: number;
    };
  } | null,
): {
  minFirstPassRate: number;
  minSamples: number;
  maxLintEscapeRate: number;
} {
  const raw = policy?.progressiveAutonomy;
  return {
    minFirstPassRate:
      finiteNumber(raw?.minFirstPassRate) ?? DEFAULT_PROGRESSIVE_AUTONOMY.minFirstPassRate,
    minSamples: Math.max(
      0,
      Math.floor(finiteNumber(raw?.minSamples) ?? DEFAULT_PROGRESSIVE_AUTONOMY.minSamples),
    ),
    maxLintEscapeRate:
      finiteNumber(raw?.maxLintEscapeRate) ?? DEFAULT_PROGRESSIVE_AUTONOMY.maxLintEscapeRate,
  };
}

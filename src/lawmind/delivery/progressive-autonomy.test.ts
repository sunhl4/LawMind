import { describe, expect, it } from "vitest";
import {
  isAutonomyUnlocked,
  resolveProgressiveAutonomyThresholds,
} from "./progressive-autonomy.js";
import { DEFAULT_PROGRESSIVE_AUTONOMY } from "./types.js";

const unlockBase = {
  firstPassRate: 0.85,
  firstPassSamples: 20,
  lintEscapeRate: 0.1,
  lintEscapeSamples: 20,
};

describe("isAutonomyUnlocked", () => {
  it("unlocks when first-pass and lint-escape series both qualify", () => {
    expect(isAutonomyUnlocked(unlockBase)).toBe(true);
  });

  it("refuses when lint-escape series is missing (null rate)", () => {
    expect(
      isAutonomyUnlocked({
        ...unlockBase,
        lintEscapeRate: null,
        lintEscapeSamples: 20,
      }),
    ).toBe(false);
  });

  it("refuses when lint-escape samples are missing (null)", () => {
    expect(
      isAutonomyUnlocked({
        ...unlockBase,
        lintEscapeRate: 0,
        lintEscapeSamples: null,
      }),
    ).toBe(false);
  });

  it("refuses empty lint-escape series (samples === 0)", () => {
    expect(
      isAutonomyUnlocked({
        ...unlockBase,
        lintEscapeRate: 0,
        lintEscapeSamples: 0,
      }),
    ).toBe(false);
  });

  it("does not treat null lintEscapeRate as 0 (JS null <= max is true)", () => {
    expect(
      isAutonomyUnlocked({
        firstPassRate: 1,
        firstPassSamples: 100,
        lintEscapeRate: null,
        lintEscapeSamples: 50,
      }),
    ).toBe(false);
  });

  it("refuses insufficient first-pass samples or rate", () => {
    expect(
      isAutonomyUnlocked({
        ...unlockBase,
        firstPassSamples: 19,
      }),
    ).toBe(false);
    expect(
      isAutonomyUnlocked({
        ...unlockBase,
        firstPassRate: 0.79,
      }),
    ).toBe(false);
    expect(
      isAutonomyUnlocked({
        ...unlockBase,
        firstPassRate: null,
      }),
    ).toBe(false);
  });

  it("refuses lint-escape rate above the cap", () => {
    expect(
      isAutonomyUnlocked({
        ...unlockBase,
        lintEscapeRate: 0.16,
      }),
    ).toBe(false);
  });

  it("honors custom thresholds from policy", () => {
    expect(
      isAutonomyUnlocked({
        firstPassRate: 0.7,
        firstPassSamples: 5,
        lintEscapeRate: 0.2,
        lintEscapeSamples: 5,
        minFirstPassRate: 0.7,
        minSamples: 5,
        maxLintEscapeRate: 0.2,
      }),
    ).toBe(true);
    expect(
      isAutonomyUnlocked({
        firstPassRate: 0.7,
        firstPassSamples: 5,
        lintEscapeRate: 0.21,
        lintEscapeSamples: 5,
        minFirstPassRate: 0.7,
        minSamples: 5,
        maxLintEscapeRate: 0.2,
      }),
    ).toBe(false);
  });
});

describe("resolveProgressiveAutonomyThresholds", () => {
  it("uses conservative defaults when policy is omitted", () => {
    expect(resolveProgressiveAutonomyThresholds(null)).toEqual(DEFAULT_PROGRESSIVE_AUTONOMY);
    expect(resolveProgressiveAutonomyThresholds({})).toEqual(DEFAULT_PROGRESSIVE_AUTONOMY);
  });

  it("reads optional policy overrides", () => {
    expect(
      resolveProgressiveAutonomyThresholds({
        progressiveAutonomy: { minFirstPassRate: 0.9, minSamples: 30, maxLintEscapeRate: 0.1 },
      }),
    ).toEqual({ minFirstPassRate: 0.9, minSamples: 30, maxLintEscapeRate: 0.1 });
  });
});

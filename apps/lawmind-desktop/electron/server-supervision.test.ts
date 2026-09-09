import { describe, expect, it } from "vitest";
import {
  computeSupervisionBackoffMs,
  SERVER_SUPERVISION_DEFAULTS,
  shouldAttemptSupervisedRestart,
} from "./server-supervision.mjs";

describe("server-supervision backoff", () => {
  it("grows exponentially from baseDelayMs with factor 2", () => {
    expect(computeSupervisionBackoffMs(1)).toBe(500);
    expect(computeSupervisionBackoffMs(2)).toBe(1000);
    expect(computeSupervisionBackoffMs(3)).toBe(2000);
    expect(computeSupervisionBackoffMs(4)).toBe(4000);
    expect(computeSupervisionBackoffMs(5)).toBe(8000);
  });

  it("caps at maxDelayMs", () => {
    expect(computeSupervisionBackoffMs(10)).toBe(SERVER_SUPERVISION_DEFAULTS.maxDelayMs);
    expect(computeSupervisionBackoffMs(100)).toBe(30_000);
  });

  it("honors custom options", () => {
    const opts = { baseDelayMs: 100, factor: 3, maxDelayMs: 1000 };
    expect(computeSupervisionBackoffMs(1, opts)).toBe(100);
    expect(computeSupervisionBackoffMs(2, opts)).toBe(300);
    expect(computeSupervisionBackoffMs(3, opts)).toBe(900);
    expect(computeSupervisionBackoffMs(4, opts)).toBe(1000);
  });

  it("floors and clamps attempt input", () => {
    expect(computeSupervisionBackoffMs(0)).toBe(500);
    expect(computeSupervisionBackoffMs(2.9)).toBe(1000);
  });
});

describe("server-supervision give-up", () => {
  it("allows up to maxAttempts then gives up", () => {
    for (let attempt = 1; attempt <= SERVER_SUPERVISION_DEFAULTS.maxAttempts; attempt++) {
      expect(shouldAttemptSupervisedRestart(attempt)).toBe(true);
    }
    expect(shouldAttemptSupervisedRestart(SERVER_SUPERVISION_DEFAULTS.maxAttempts + 1)).toBe(false);
    expect(shouldAttemptSupervisedRestart(99)).toBe(false);
  });

  it("honors custom maxAttempts", () => {
    expect(shouldAttemptSupervisedRestart(2, { maxAttempts: 2 })).toBe(true);
    expect(shouldAttemptSupervisedRestart(3, { maxAttempts: 2 })).toBe(false);
  });
});

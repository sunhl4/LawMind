import { describe, expect, it } from "vitest";
import { computeRetryDelayMs, isRetryableHttpFailure } from "./http-retry.js";

describe("isRetryableHttpFailure", () => {
  it("retries rate limits and 5xx", () => {
    expect(isRetryableHttpFailure(new Error("x"), 429)).toBe(true);
    expect(isRetryableHttpFailure(new Error("x"), 503)).toBe(true);
  });

  it("does not retry 4xx auth/validation errors", () => {
    expect(isRetryableHttpFailure(new Error("x"), 401)).toBe(false);
    expect(isRetryableHttpFailure(new Error("x"), 422)).toBe(false);
  });

  it("retries transient network errors", () => {
    const err = new Error("fetch failed");
    expect(isRetryableHttpFailure(err)).toBe(true);
  });

  it("retries abort/timeouts", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isRetryableHttpFailure(err)).toBe(true);
  });
});

describe("computeRetryDelayMs", () => {
  it("grows with attempt and stays within a bounded range", () => {
    const d0 = computeRetryDelayMs(0, 100);
    const d2 = computeRetryDelayMs(2, 100);
    expect(d0).toBeGreaterThanOrEqual(100);
    expect(d0).toBeLessThan(500);
    expect(d2).toBeGreaterThanOrEqual(400);
    expect(d2).toBeLessThan(900);
  });
});

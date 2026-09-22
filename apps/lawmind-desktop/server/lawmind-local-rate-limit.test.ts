import { describe, expect, it } from "vitest";
import {
  getRateLimitStats,
  registerRateLimitBucket,
  TokenBucket,
} from "./lawmind-local-rate-limit.js";

describe("lawmind-local-rate-limit", () => {
  it("tracks consumption and rejections via getRateLimitStats", () => {
    const bucket = new TokenBucket({ rate: 1, capacity: 1 });
    registerRateLimitBucket(bucket);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
    const stats = getRateLimitStats();
    expect(stats).toMatchObject({
      rate: 1,
      capacity: 1,
      rejected: 1,
    });
    expect(typeof stats?.tokens).toBe("number");
  });
});

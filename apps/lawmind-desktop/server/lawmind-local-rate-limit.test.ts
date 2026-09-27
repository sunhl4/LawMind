import { describe, expect, it } from "vitest";
import {
  getRateLimitStats,
  isShellLaneRequest,
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

  it("keeps shell reads off the shared bucket", () => {
    expect(isShellLaneRequest("GET", "/api/bootstrap")).toBe(true);
    expect(isShellLaneRequest("GET", "/.well-known/lawmind-local")).toBe(true);
    expect(isShellLaneRequest("OPTIONS", "/api/chat")).toBe(true);
    expect(isShellLaneRequest("GET", "/api/health")).toBe(false);
    expect(isShellLaneRequest("GET", "/api/tasks")).toBe(false);
    expect(isShellLaneRequest("GET", "/api/history")).toBe(false);
    expect(isShellLaneRequest("GET", "/api/matters/overviews")).toBe(false);
    expect(isShellLaneRequest("POST", "/api/chat")).toBe(false);
    expect(isShellLaneRequest("GET", "/api/jobs")).toBe(false);
  });
});

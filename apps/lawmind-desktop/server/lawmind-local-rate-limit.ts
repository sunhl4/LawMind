/**
 * Simple token-bucket rate limiter for the loopback API (abuse / runaway client guard).
 */

export type TokenBucketOptions = {
  rate: number;
  capacity: number;
};

export type RateLimitStats = {
  rate: number;
  capacity: number;
  tokens: number;
  rejected: number;
};

let activeBucket: TokenBucket | null = null;

export function registerRateLimitBucket(bucket: TokenBucket): void {
  activeBucket = bucket;
}

export function getRateLimitStats(): RateLimitStats | null {
  return activeBucket?.getStats() ?? null;
}

/**
 * 只豁免打开窗口时那两条轻请求，以及浏览器预检。
 * `/api/health`、任务列表、历史、案件概览会扫盘，必须留在桶里，否则失控客户端能把事件循环打满。
 */
const SHELL_LANE_PATHS = new Set([
  "/.well-known/lawmind-local",
  "/api/bootstrap",
]);

export function isShellLaneRequest(method: string | undefined, pathname: string): boolean {
  if (method === "OPTIONS") {
    return true;
  }
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }
  return SHELL_LANE_PATHS.has(pathname);
}

export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private rejected = 0;

  constructor(private readonly opts: TokenBucketOptions) {
    this.tokens = opts.capacity;
    this.lastRefillMs = Date.now();
  }

  tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens < count) {
      this.rejected += 1;
      return false;
    }
    this.tokens -= count;
    return true;
  }

  getStats(): RateLimitStats {
    this.refill();
    return {
      rate: this.opts.rate,
      capacity: this.opts.capacity,
      tokens: Math.round(this.tokens * 100) / 100,
      rejected: this.rejected,
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) {
      return;
    }
    this.tokens = Math.min(
      this.opts.capacity,
      this.tokens + elapsedSec * this.opts.rate,
    );
    this.lastRefillMs = now;
  }
}

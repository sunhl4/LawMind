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

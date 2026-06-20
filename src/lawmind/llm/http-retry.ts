/**
 * Shared HTTP retry helpers for model / retrieval adapters.
 */

/** True when a failed request may succeed on retry (transient network / rate limit / 5xx). */
export function isRetryableHttpFailure(err: unknown, httpStatus?: number): boolean {
  if (typeof httpStatus === "number") {
    if (httpStatus === 429) {
      return true;
    }
    if (httpStatus >= 500) {
      return true;
    }
    if (httpStatus >= 400 && httpStatus < 500) {
      return false;
    }
  }

  if (err instanceof Error && err.name === "AbortError") {
    return true;
  }

  const cause =
    err instanceof Error && "cause" in err && err.cause instanceof Error ? err.cause.message : "";
  const msg = err instanceof Error ? err.message : String(err);
  const combined = `${msg} ${cause}`.trim();
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket disconnected|network/i.test(
    combined,
  );
}

/** Exponential backoff with jitter (attempt is 0-based). */
export function computeRetryDelayMs(attempt: number, baseMs = 400): number {
  const cappedAttempt = Math.min(attempt, 6);
  const exponential = baseMs * 2 ** cappedAttempt;
  const jitter = Math.floor(Math.random() * baseMs);
  return exponential + jitter;
}

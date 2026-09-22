/**
 * Shared HTTP retry helpers for model / retrieval adapters.
 */

/**
 * Extra attempts after the first try.
 * DeepSeek harness `retryPolicy.mode=normal` retries EMPTY/TRANSPORT twice.
 * Codex `request_max_retries` default is 4; this runtime already used 2 for
 * chat completions and retrieval — keep that one budget, do not invent a third.
 */
export const DEFAULT_MODEL_MAX_RETRIES = 2;

export function modelAttemptBudget(maxRetries = DEFAULT_MODEL_MAX_RETRIES): number {
  return 1 + Math.max(0, Math.floor(maxRetries));
}

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

export async function waitModelRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
}

/**
 * TRANSPORT retry, excluding lawyer Stop.
 * Timeout AbortError stays retryable; an aborted caller signal does not.
 * `HTTP 429` / `HTTP 5xx` in the error message count even when status is not passed.
 */
export function shouldRetryTransportFailure(
  err: unknown,
  opts?: { httpStatus?: number; signal?: AbortSignal },
): boolean {
  if (opts?.signal?.aborted) {
    return false;
  }
  if (err instanceof Error && err.name === "ModelCallUserAbortError") {
    return false;
  }
  const fromMessage = err instanceof Error ? /\bHTTP (\d{3})\b/.exec(err.message)?.[1] : undefined;
  const httpStatus = opts?.httpStatus ?? (fromMessage ? Number(fromMessage) : undefined);
  return isRetryableHttpFailure(err, httpStatus);
}

/**
 * Rule review runner (A6 guardrails).
 *
 * Production lessons borrowed from Harvey's playbook-review write-up:
 * per-rule timeout, retry only the affected rule, bounded concurrency,
 * and streaming each rule's result as soon as it finishes.
 *
 * The worker function is injected so this can be tested without models and
 * wired to `runDraftWorker` only where a caller opts in.
 */

import type { RuleWorkerOutput } from "./execute.js";
import type { RuleAssignment } from "./rules.js";

export type RuleRunEvent =
  | { type: "rule_started"; ruleId: string }
  | { type: "rule_finished"; ruleId: string; output: RuleWorkerOutput; attempt: number }
  | {
      type: "rule_failed";
      ruleId: string;
      error: string;
      attempt: number;
      willRetry: boolean;
    }
  | { type: "rule_timed_out"; ruleId: string; attempt: number; willRetry: boolean };

export type RuleRunOptions = {
  concurrency?: number;
  /** Per-rule timeout in ms. */
  timeoutMs?: number;
  /** Total attempts per rule (1 = no retry). */
  maxAttempts?: number;
  /** Exponential backoff base in ms; 0 disables waiting. */
  backoffMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: RuleRunEvent) => void;
  /** Test seam: sleep implementation. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export class RuleRunError extends Error {
  constructor(
    readonly ruleId: string,
    message: string,
  ) {
    super(message);
    this.name = "RuleRunError";
  }
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 2;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RuleTimeout());
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

class RuleTimeout extends Error {
  constructor() {
    super("rule timed out");
    this.name = "RuleTimeout";
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export type RuleRunResult = {
  outputs: RuleWorkerOutput[];
  failures: Array<{ ruleId: string; error: string }>;
};

/**
 * Run every assignment. A failing rule never aborts the others; failures are
 * returned so the caller can report `coverage: incomplete` honestly.
 */
export async function runRuleAssignments(
  assignments: readonly RuleAssignment[],
  worker: (assignment: RuleAssignment, signal: AbortSignal) => Promise<RuleWorkerOutput>,
  options: RuleRunOptions = {},
): Promise<RuleRunResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const backoffMs = options.backoffMs ?? 0;
  const sleep = options.sleep ?? defaultSleep;
  const emit = options.onEvent ?? (() => undefined);

  const attemptsByRule = new Map<string, number>();

  const settled = await mapWithConcurrency(assignments, concurrency, async (assignment) => {
    const ruleId = assignment.ruleId;
    let lastError = "unknown error";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsByRule.set(ruleId, attempt);
      if (options.signal?.aborted) {
        lastError = "aborted";
        break;
      }
      emit({ type: "rule_started", ruleId });
      try {
        const output = await withTimeout(
          (signal) => worker(assignment, signal),
          timeoutMs,
          options.signal,
        );
        emit({ type: "rule_finished", ruleId, output, attempt });
        return { ok: true as const, output };
      } catch (err) {
        const timedOut = err instanceof RuleTimeout;
        lastError = err instanceof Error ? err.message : String(err);
        const willRetry = attempt < maxAttempts && !options.signal?.aborted;
        if (timedOut) {
          emit({ type: "rule_timed_out", ruleId, attempt, willRetry });
        } else {
          emit({ type: "rule_failed", ruleId, error: lastError, attempt, willRetry });
        }
        if (!willRetry) {
          break;
        }
        if (backoffMs > 0) {
          await sleep(backoffMs * 2 ** (attempt - 1));
        }
      }
    }

    return { ok: false as const, ruleId, error: lastError };
  });

  const outputs: RuleWorkerOutput[] = [];
  const failures: Array<{ ruleId: string; error: string }> = [];
  for (const item of settled) {
    if (item.ok) {
      outputs.push(item.output);
    } else {
      failures.push({ ruleId: item.ruleId, error: item.error });
    }
  }
  return { outputs, failures };
}

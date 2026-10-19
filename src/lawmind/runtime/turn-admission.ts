/**
 * Process-wide admission for concurrent conversations.
 *
 * One lawyer desktop runs many chats at once. A single conversation still has
 * its own turn gate. These limits are shared by every chat, workflow, and
 * read-only worker in the process:
 * - model samples (initial 8; 429 halves the live cap; successes raise it back,
 *   never above 8, or above an explicit LAWMIND_MAX_MODEL_CONCURRENCY)
 * - one in-flight model sample reserved per conversation before a second lane,
 *   only after the shared cap is full
 * - top-level writes, capped per conversation; concurrency-safe reads are not slotted
 * - one lease per file path, and one in-flight call each for LibreOffice / Word
 * 法宝检索不限流，多个对话、多路查询同时发出。服务商返回 429 时再退避。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { getMaxToolUseConcurrency } from "./tool-concurrency.js";

const MODEL_HARD_CAP = 8;
const DEFAULT_MODEL_SLOTS = 8;
/** A second model lane yields to any conversation that has none, unless it has waited this long. */
export const MODEL_ADMISSION_AGE_MS = 8_000;
/** Consecutive successful outer samples before the live model cap grows by one. */
export const MODEL_SUCCESS_STREAK_FOR_INCREASE = 8;

export type ModelAdmissionKind = "parent" | "worker";

export type ModelAdmissionIdentity = {
  sessionId: string;
  kind: ModelAdmissionKind;
};

export const RESOURCE_LEASE_SOFFICE = "external:soffice";
export const RESOURCE_LEASE_WORD = "external:word";

const PATH_ARG_KEYS = [
  "path",
  "filePath",
  "file_path",
  "outputPath",
  "output_path",
  "documentPath",
  "docxPath",
  "absPath",
  "sourcePath",
  "targetPath",
  "contract_edit_baseline_path",
  "baseline_path",
  "baselinePath",
  "rel_path",
  "relPath",
] as const;

/** Per-session state. Two chats must be able to update their own plans together. */
const UNLEASED_TOOLS = new Set(["update_plan", "draft_worker"]);

export class AdmissionAbortedError extends Error {
  readonly name = "AdmissionAbortedError";
  constructor(message = "已停止") {
    super(message);
  }
}

type Waiter = {
  grant: () => void;
  cancel: (err: Error) => void;
  detachAbort?: () => void;
  sessionKey: string;
  enqueuedAt: number;
};

type SlotPool = {
  inFlight: number;
  waiters: Waiter[];
  /** Session keys of callers that currently hold a slot. Model pool only. */
  holders: string[];
  cap: () => number;
  /** Model pool prefers a conversation with no in-flight sample. Other pools stay FIFO. */
  fair: boolean;
};

const modelDepth = new AsyncLocalStorage<number>();
const toolDepth = new AsyncLocalStorage<number>();
const heldLeases = new AsyncLocalStorage<Set<string>>();

const modelPool: SlotPool = {
  inFlight: 0,
  waiters: [],
  holders: [],
  cap: getMaxModelConcurrency,
  fair: true,
};
function newToolPool(): SlotPool {
  return {
    inFlight: 0,
    waiters: [],
    holders: [],
    cap: getMaxToolUseConcurrency,
    fair: false,
  };
}

/** Callers without a conversation id (tests, digests) share this pool. */
const sharedToolPool: SlotPool = newToolPool();
const toolPoolsBySession = new Map<string, SlotPool>();

function toolPoolFor(opts?: AdmitOpts): SlotPool {
  const sessionId = opts?.identity?.sessionId?.trim();
  if (!sessionId) {
    return sharedToolPool;
  }
  const existing = toolPoolsBySession.get(sessionId);
  if (existing) {
    return existing;
  }
  const created = newToolPool();
  toolPoolsBySession.set(sessionId, created);
  return created;
}

let dynamicModelCap: number | null = null;
let modelSuccessStreak = 0;
let dynamicCapEnvKey = process.env.LAWMIND_MAX_MODEL_CONCURRENCY?.trim() ?? "";
let anonAdmissionSeq = 0;
const resourcePools = new Map<string, SlotPool>();

function envModelRaw(): string {
  return process.env.LAWMIND_MAX_MODEL_CONCURRENCY?.trim() ?? "";
}

function envModelCeiling(): number {
  const raw = envModelRaw();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_MODEL_SLOTS;
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_MODEL_SLOTS;
  }
  return Math.min(MODEL_HARD_CAP, Math.floor(n));
}

/** Unset env may grow from 2 to 3. An explicit env value is the ceiling. */
function aimdCeiling(): number {
  if (!envModelRaw()) {
    return MODEL_HARD_CAP;
  }
  return envModelCeiling();
}

function syncDynamicCapToEnv(): void {
  const key = envModelRaw();
  if (key === dynamicCapEnvKey) {
    return;
  }
  dynamicCapEnvKey = key;
  dynamicModelCap = null;
  modelSuccessStreak = 0;
}

/** Live model slots. Unset starts at 2 and may move inside 1..3. An explicit env value caps that. */
export function getMaxModelConcurrency(): number {
  syncDynamicCapToEnv();
  if (dynamicModelCap == null) {
    return envModelCeiling();
  }
  return Math.min(aimdCeiling(), Math.max(1, dynamicModelCap));
}

/** HTTP 429: halve the live cap (floor 1) and let any newly freed room drain. */
export function noteModelRateLimit(): void {
  dynamicModelCap = Math.max(1, Math.floor(getMaxModelConcurrency() / 2));
  modelSuccessStreak = 0;
  drain(modelPool);
}

/** One successful outer sample. Eight in a row raise the live cap by one, up to the AIMD ceiling. */
export function noteModelSampleSuccess(): void {
  modelSuccessStreak += 1;
  if (modelSuccessStreak < MODEL_SUCCESS_STREAK_FOR_INCREASE) {
    return;
  }
  modelSuccessStreak = 0;
  const current = getMaxModelConcurrency();
  const next = Math.min(aimdCeiling(), current + 1);
  if (next === current) {
    return;
  }
  dynamicModelCap = next;
  drain(modelPool);
}

/**
 * Index of the next model waiter.
 * Lane 0: this conversation has no in-flight sample, or the waiter has aged past {@link MODEL_ADMISSION_AGE_MS}.
 * Lane 1: a second sample for a conversation that already holds one.
 * Same lane keeps arrival order.
 */
export type SelectModelWaiterEntry = { sessionKey: string; enqueuedAt: number };

export function selectModelWaiter(
  waiters: readonly SelectModelWaiterEntry[],
  holders: readonly string[],
  now: number,
  ageMs = MODEL_ADMISSION_AGE_MS,
): number {
  if (waiters.length === 0) {
    return -1;
  }
  const inflightOf = (key: string) => {
    let count = 0;
    for (const holder of holders) {
      if (holder === key) {
        count += 1;
      }
    }
    return count;
  };
  const lane = (waiter: SelectModelWaiterEntry) => {
    const aged = now - waiter.enqueuedAt >= ageMs;
    return inflightOf(waiter.sessionKey) > 0 && !aged ? 1 : 0;
  };
  let best = 0;
  for (let index = 1; index < waiters.length; index += 1) {
    const candidate = waiters[index];
    const current = waiters[best];
    if (!candidate || !current) {
      continue;
    }
    const candidateLane = lane(candidate);
    const bestLane = lane(current);
    if (
      candidateLane < bestLane ||
      (candidateLane === bestLane && candidate.enqueuedAt < current.enqueuedAt)
    ) {
      best = index;
    }
  }
  return best;
}

export function resourceLeaseKeyForTool(
  toolName: string,
  args: Record<string, unknown>,
  concurrencySafe: boolean,
): string | null {
  if (concurrencySafe || UNLEASED_TOOLS.has(toolName)) {
    return null;
  }
  for (const key of PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return `path:${path.resolve(value.trim())}`;
    }
  }
  // No path: do not invent a process-wide tool lock. Two chats may draft
  // different memos at once. Same-path writes still share one lease.
  return null;
}

type AdmitOpts = {
  signal?: AbortSignal;
  /** Fired once when this caller is queued behind a full pool. */
  onWait?: () => void;
  /** Fired once the slot is held, including when nobody had to wait. */
  onGranted?: () => void;
  /** Parent samples and subagents share a conversation id so the first lane is reserved. */
  identity?: ModelAdmissionIdentity;
};

export async function withModelAdmission<T>(fn: () => Promise<T>, opts?: AdmitOpts): Promise<T> {
  if ((modelDepth.getStore() ?? 0) > 0) {
    return fn();
  }
  const ticket = await acquire(modelPool, opts);
  try {
    opts?.onGranted?.();
    return await modelDepth.run(1, fn);
  } finally {
    release(modelPool, ticket);
  }
}

export async function withTurnToolSlot<T>(fn: () => Promise<T>, opts?: AdmitOpts): Promise<T> {
  if ((toolDepth.getStore() ?? 0) > 0) {
    return fn();
  }
  const pool = toolPoolFor(opts);
  const sessionId = opts?.identity?.sessionId?.trim();
  await acquire(pool, opts);
  try {
    opts?.onGranted?.();
    return await toolDepth.run(1, fn);
  } finally {
    release(pool);
    if (
      sessionId &&
      pool.inFlight === 0 &&
      pool.waiters.length === 0 &&
      toolPoolsBySession.get(sessionId) === pool
    ) {
      toolPoolsBySession.delete(sessionId);
    }
  }
}

export async function withResourceLease<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: AdmitOpts,
): Promise<T> {
  const held = heldLeases.getStore();
  if (held?.has(key)) {
    return fn();
  }
  const pool = resourcePool(key);
  await acquire(pool, opts);
  const next = new Set(held);
  next.add(key);
  try {
    opts?.onGranted?.();
    return await heldLeases.run(next, fn);
  } finally {
    release(pool);
    if (pool.inFlight === 0 && pool.waiters.length === 0) {
      resourcePools.delete(key);
    }
  }
}

function resourcePool(key: string): SlotPool {
  const existing = resourcePools.get(key);
  if (existing) {
    return existing;
  }
  const created: SlotPool = { inFlight: 0, waiters: [], holders: [], cap: () => 1, fair: false };
  resourcePools.set(key, created);
  return created;
}

function admissionSessionKey(opts?: AdmitOpts): string {
  const id = opts?.identity?.sessionId?.trim();
  if (id) {
    return id;
  }
  anonAdmissionSeq += 1;
  return `anon:${anonAdmissionSeq}`;
}

function holdSlot(pool: SlotPool, sessionKey: string): void {
  pool.inFlight += 1;
  if (pool.fair) {
    pool.holders.push(sessionKey);
  }
}

function acquire(pool: SlotPool, opts?: AdmitOpts): Promise<string> {
  if (opts?.signal?.aborted) {
    return Promise.reject(new AdmissionAbortedError());
  }
  const sessionKey = admissionSessionKey(opts);
  const cap = Math.max(1, pool.cap());
  if (pool.inFlight < cap && pool.waiters.length === 0) {
    holdSlot(pool, sessionKey);
    return Promise.resolve(sessionKey);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const waiter: Waiter = {
      sessionKey,
      enqueuedAt: Date.now(),
      grant: () => {
        if (settled) {
          return;
        }
        settled = true;
        waiter.detachAbort?.();
        holdSlot(pool, sessionKey);
        resolve(sessionKey);
      },
      cancel: (err) => {
        if (settled) {
          return;
        }
        settled = true;
        waiter.detachAbort?.();
        reject(err);
      },
    };
    pool.waiters.push(waiter);
    if (pool.inFlight < Math.max(1, pool.cap())) {
      drain(pool);
    }
    if (settled) {
      return;
    }
    if (opts?.signal) {
      const onAbort = () => {
        const index = pool.waiters.indexOf(waiter);
        if (index >= 0) {
          pool.waiters.splice(index, 1);
        }
        waiter.cancel(new AdmissionAbortedError());
      };
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
      waiter.detachAbort = () => opts.signal?.removeEventListener("abort", onAbort);
    }
    try {
      opts?.onWait?.();
    } catch {
      /* a progress callback must not drop the waiter */
    }
  });
}

function release(pool: SlotPool, sessionKey?: string): void {
  pool.inFlight = Math.max(0, pool.inFlight - 1);
  if (pool.fair && sessionKey) {
    const index = pool.holders.indexOf(sessionKey);
    if (index >= 0) {
      pool.holders.splice(index, 1);
    }
  }
  drain(pool);
}

function drain(pool: SlotPool): void {
  const now = Date.now();
  while (pool.waiters.length > 0) {
    const cap = Math.max(1, pool.cap());
    if (pool.inFlight >= cap) {
      return;
    }
    const index = pool.fair ? selectModelWaiter(pool.waiters, pool.holders, now) : 0;
    if (index < 0) {
      return;
    }
    const next = pool.waiters[index];
    if (!next) {
      return;
    }
    pool.waiters.splice(index, 1);
    next.grant();
  }
}

/** Test helper. Does not unblock waiters; call only when none are in flight. */
export function resetTurnAdmissionForTests(): void {
  dynamicModelCap = null;
  modelSuccessStreak = 0;
  dynamicCapEnvKey = process.env.LAWMIND_MAX_MODEL_CONCURRENCY?.trim() ?? "";
  modelPool.inFlight = 0;
  modelPool.waiters.length = 0;
  modelPool.holders.length = 0;
  sharedToolPool.inFlight = 0;
  sharedToolPool.waiters.length = 0;
  sharedToolPool.holders.length = 0;
  toolPoolsBySession.clear();
  resourcePools.clear();
}

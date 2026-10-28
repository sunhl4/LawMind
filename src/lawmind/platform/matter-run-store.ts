/**
 * MatterRun 落盘：`<workspace>/matters/<matterId>/runs/`。
 *
 *   <runId>.json         运行真相源（原子写；锁内读改写）
 *   <runId>.events.jsonl 运行时间线（可回放，不参与判定）
 *   <runId>.lock         跨进程互斥（O_EXCL，stale 自愈）
 *
 * 为什么不是 `cases/<matterId>/runs/`：`cases/<id>/CASE.md` 是律师可读叙事，
 * `matters/<id>/matter.json` 才是机器状态真相源；执行状态跟随后者。
 *
 * 崩溃安全：领取步骤时先落盘 `running` + 尝试次数 + 租约，再执行副作用。
 * 进程在副作用中途被杀，重启后由 `recoverInterruptedMatterRuns` 接管；
 * 执行器必须用步骤的 `idempotencyKey` 做去重，保证「重放」不等于「重复外发」。
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendJsonl,
  listMatterIdsFromStorage,
  matterDir,
  readJsonl,
  readJsonValidated,
  withExclusiveFileLock,
  writeJsonAtomic,
} from "../adapters/matter-storage/io.js";
import {
  MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS,
  MATTER_RUN_WAIT_EXTEND_MAX_DAYS,
} from "./matter-run-wait.js";
import {
  completeMatterRunStep,
  createMatterRun,
  escalateDueWaitSteps,
  extendMatterRunWait,
  failMatterRunStep,
  isMatterRunStepLeaseActive,
  isTerminalMatterRunStatus,
  nextRunnableMatterRunStep,
  recoverInterruptedMatterRun,
  skipMatterRunStep,
  startMatterRunStep,
  waitMatterRunStep,
  wakeMatterRunForEvent,
  type CreateMatterRunInput,
  type MatterRun,
  type MatterRunStatus,
  type MatterRunStep,
  type MatterRunWait,
  MatterRunSchema,
} from "./matter-run.js";

export const MATTER_RUN_EVENT_SCHEMA_VERSION = 1;

export const MATTER_RUN_EVENT_TYPES = [
  "run_created",
  "step_started",
  "step_done",
  "step_failed",
  "step_skipped",
  "step_waiting",
  "step_woken",
  "step_interrupted",
  "wait_escalated",
  "wait_extended",
  "run_recovered",
] as const;

export const MatterRunEventSchema = z.object({
  schemaVersion: z.literal(MATTER_RUN_EVENT_SCHEMA_VERSION),
  at: z.string(),
  type: z.enum(MATTER_RUN_EVENT_TYPES),
  runId: z.string().min(1).max(128),
  matterId: z.string().min(1).max(128),
  stepId: z.string().min(1).max(128).optional(),
  attempts: z.number().int().nonnegative().optional(),
  detail: z.string().max(2000).optional(),
});
export type MatterRunEvent = z.infer<typeof MatterRunEventSchema>;

const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

function assertSafeRunId(runId: string): string {
  const trimmed = runId.trim();
  if (!SAFE_RUN_ID.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`unsafe matter run id: ${runId}`);
  }
  return trimmed;
}

export function matterRunsDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "runs");
}

export function matterRunPath(workspaceDir: string, matterId: string, runId: string): string {
  return path.join(matterRunsDir(workspaceDir, matterId), `${assertSafeRunId(runId)}.json`);
}

export function matterRunEventsPath(workspaceDir: string, matterId: string, runId: string): string {
  return path.join(matterRunsDir(workspaceDir, matterId), `${assertSafeRunId(runId)}.events.jsonl`);
}

export function matterRunLockPath(workspaceDir: string, matterId: string, runId: string): string {
  return path.join(matterRunsDir(workspaceDir, matterId), `${assertSafeRunId(runId)}.lock`);
}

function iso(at?: string | Date): string {
  if (!at) {
    return new Date().toISOString();
  }
  return typeof at === "string" ? at : at.toISOString();
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 2000);
}

/** 落一条 run 事件；观测路径，写失败不能打挂真正的办件。 */
export function appendMatterRunEvent(
  workspaceDir: string,
  event: Omit<MatterRunEvent, "schemaVersion">,
): void {
  try {
    appendJsonl(
      matterRunEventsPath(workspaceDir, event.matterId, event.runId),
      MatterRunEventSchema,
      {
        schemaVersion: MATTER_RUN_EVENT_SCHEMA_VERSION,
        ...event,
      },
    );
  } catch {
    /* best-effort */
  }
}

export function readMatterRunEvents(
  workspaceDir: string,
  matterId: string,
  runId: string,
): MatterRunEvent[] {
  return readJsonl(matterRunEventsPath(workspaceDir, matterId, runId), MatterRunEventSchema);
}

/** 校验 + 原子写。run 对象不可变更新，调用方拿返回值继续。 */
export function saveMatterRun(workspaceDir: string, run: MatterRun): void {
  const parsed = MatterRunSchema.parse(run);
  writeJsonAtomic(matterRunPath(workspaceDir, parsed.matterId, parsed.runId), parsed);
}

/**
 * 新建 run 并落盘。`runId` 冲突直接抛错——调用方若需要幂等创建，
 * 先用 `findMatterRunByKey` 或固定 `runId`。
 */
export function createMatterRunOnDisk(
  workspaceDir: string,
  input: CreateMatterRunInput,
): MatterRun {
  const run = createMatterRun(input);
  saveMatterRun(workspaceDir, run);
  appendMatterRunEvent(workspaceDir, {
    at: run.createdAt,
    type: "run_created",
    runId: run.runId,
    matterId: run.matterId,
    detail: input.title,
  });
  return run;
}

export function loadMatterRun(
  workspaceDir: string,
  matterId: string,
  runId: string,
  opts: { tolerateCorrupt?: boolean } = {},
): MatterRun | undefined {
  try {
    return readJsonValidated(matterRunPath(workspaceDir, matterId, runId), MatterRunSchema);
  } catch (err) {
    if (opts.tolerateCorrupt) {
      return undefined;
    }
    throw err;
  }
}

export function listMatterRunIds(workspaceDir: string, matterId: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(matterRunsDir(workspaceDir, matterId));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length))
    .filter((id) => SAFE_RUN_ID.test(id))
    .toSorted();
}

export type ListMatterRunsOptions = {
  matterId?: string;
  statuses?: MatterRunStatus[];
  /** 扫描时跳过坏文件（默认 true）。 */
  tolerateCorrupt?: boolean;
};

/** 跨案件列出 run。默认跳过坏文件：一个坏 JSON 不能挡住其它案件的恢复。 */
export function listMatterRuns(
  workspaceDir: string,
  opts: ListMatterRunsOptions = {},
): MatterRun[] {
  const matterIds = opts.matterId
    ? [opts.matterId]
    : listMatterIdsFromStorage(workspaceDir).toSorted();
  const statuses = opts.statuses ? new Set(opts.statuses) : undefined;
  const tolerateCorrupt = opts.tolerateCorrupt ?? true;
  const out: MatterRun[] = [];
  for (const matterId of matterIds) {
    let runIds: string[] = [];
    try {
      runIds = listMatterRunIds(workspaceDir, matterId);
    } catch {
      // 目录名不是合法 matterId：跳过，别让一个脏目录挡住全工作区恢复。
      continue;
    }
    for (const runId of runIds) {
      const run = loadMatterRun(workspaceDir, matterId, runId, { tolerateCorrupt });
      if (!run) {
        continue;
      }
      if (statuses && !statuses.has(run.status)) {
        continue;
      }
      out.push(run);
    }
  }
  return out;
}

/** 同一 run 的读改写必须在锁内；锁不可重入，回调里不要再调本文件的加锁函数。 */
export function withMatterRunLock<T>(
  workspaceDir: string,
  matterId: string,
  runId: string,
  fn: () => T,
  opts?: { timeoutMs?: number; staleMs?: number },
): T {
  return withExclusiveFileLock(matterRunLockPath(workspaceDir, matterId, runId), fn, {
    ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts?.staleMs ? { staleMs: opts.staleMs } : {}),
  });
}

export type RecoverInterruptedResult = {
  runIds: string[];
  recoveredStepIds: string[];
  exhaustedStepIds: string[];
};

/**
 * 启动恢复：`running` 步骤回到 `pending`。
 *
 * `force` 只允许在拿到单实例锁之后使用（例如守护进程启动）；常规 tick 必须走
 * 租约判定，避免两个进程同时接管同一个步骤。
 */
export function recoverInterruptedMatterRuns(
  workspaceDir: string,
  opts: { at?: string | Date; force?: boolean; matterId?: string } = {},
): RecoverInterruptedResult {
  const at = iso(opts.at);
  const result: RecoverInterruptedResult = {
    runIds: [],
    recoveredStepIds: [],
    exhaustedStepIds: [],
  };
  const running = listMatterRuns(workspaceDir, {
    ...(opts.matterId ? { matterId: opts.matterId } : {}),
    statuses: ["running"],
  });
  for (const candidate of running) {
    try {
      withMatterRunLock(workspaceDir, candidate.matterId, candidate.runId, () => {
        const fresh = loadMatterRun(workspaceDir, candidate.matterId, candidate.runId, {
          tolerateCorrupt: true,
        });
        if (!fresh || fresh.status !== "running") {
          return;
        }
        if (!opts.force) {
          const anyActive = fresh.steps.some((s) => isMatterRunStepLeaseActive(s, { now: at }));
          if (anyActive) {
            return;
          }
        }
        const { run, recoveredStepIds, exhaustedStepIds } = recoverInterruptedMatterRun(fresh, at);
        if (!recoveredStepIds.length && !exhaustedStepIds.length) {
          return;
        }
        saveMatterRun(workspaceDir, run);
        result.runIds.push(run.runId);
        result.recoveredStepIds.push(...recoveredStepIds);
        result.exhaustedStepIds.push(...exhaustedStepIds);
        for (const stepId of recoveredStepIds) {
          appendMatterRunEvent(workspaceDir, {
            at,
            type: "step_interrupted",
            runId: run.runId,
            matterId: run.matterId,
            stepId,
            detail: "进程中断，步骤回到待执行",
          });
        }
        for (const stepId of exhaustedStepIds) {
          appendMatterRunEvent(workspaceDir, {
            at,
            type: "step_failed",
            runId: run.runId,
            matterId: run.matterId,
            stepId,
            detail: "attempts_exhausted",
          });
        }
        appendMatterRunEvent(workspaceDir, {
          at,
          type: "run_recovered",
          runId: run.runId,
          matterId: run.matterId,
          detail: `recovered=${recoveredStepIds.length} exhausted=${exhaustedStepIds.length}`,
        });
      });
    } catch {
      // 单个 run 的锁竞争/坏档不影响其它案件的恢复。
      continue;
    }
  }
  return result;
}

export type WakeMatterRunsResult = {
  runIds: string[];
  wokeStepIds: string[];
};

/**
 * 外部事件唤醒等待中的 run（来件归档、邮件入库、律师决定）。
 * 只扫描 `waiting`，不误碰正在执行的步骤。
 */
export function wakeMatterRunsForEvent(
  workspaceDir: string,
  eventKey: string,
  opts: { matterId?: string; at?: string | Date } = {},
): WakeMatterRunsResult {
  const at = iso(opts.at);
  const result: WakeMatterRunsResult = { runIds: [], wokeStepIds: [] };
  const waiting = listMatterRuns(workspaceDir, {
    ...(opts.matterId ? { matterId: opts.matterId } : {}),
    statuses: ["waiting"],
  });
  for (const candidate of waiting) {
    try {
      withMatterRunLock(workspaceDir, candidate.matterId, candidate.runId, () => {
        const fresh = loadMatterRun(workspaceDir, candidate.matterId, candidate.runId, {
          tolerateCorrupt: true,
        });
        if (!fresh || fresh.status !== "waiting") {
          return;
        }
        const { run, wokeStepIds } = wakeMatterRunForEvent(fresh, eventKey, at);
        if (!wokeStepIds.length) {
          return;
        }
        saveMatterRun(workspaceDir, run);
        result.runIds.push(run.runId);
        result.wokeStepIds.push(...wokeStepIds);
        for (const stepId of wokeStepIds) {
          appendMatterRunEvent(workspaceDir, {
            at,
            type: "step_woken",
            runId: run.runId,
            matterId: run.matterId,
            stepId,
            detail: eventKey,
          });
        }
      });
    } catch {
      // 锁竞争/坏档：这一条留到下一轮，不阻断归档本身。
      continue;
    }
  }
  return result;
}

export type EscalateWaitsResult = {
  runIds: string[];
  escalatedStepIds: string[];
};

/** 等待超时 → 律师待办标记（仍保持 waiting，外部事件到达仍可唤醒）。 */
export function escalateDueMatterRunWaits(
  workspaceDir: string,
  opts: { at?: string | Date; matterId?: string } = {},
): EscalateWaitsResult {
  const at = iso(opts.at);
  const result: EscalateWaitsResult = { runIds: [], escalatedStepIds: [] };
  const waiting = listMatterRuns(workspaceDir, {
    ...(opts.matterId ? { matterId: opts.matterId } : {}),
    statuses: ["waiting"],
  });
  for (const candidate of waiting) {
    try {
      withMatterRunLock(workspaceDir, candidate.matterId, candidate.runId, () => {
        const fresh = loadMatterRun(workspaceDir, candidate.matterId, candidate.runId, {
          tolerateCorrupt: true,
        });
        if (!fresh || fresh.status !== "waiting") {
          return;
        }
        const { run, escalatedStepIds } = escalateDueWaitSteps(fresh, { now: at });
        if (!escalatedStepIds.length) {
          return;
        }
        saveMatterRun(workspaceDir, run);
        result.runIds.push(run.runId);
        result.escalatedStepIds.push(...escalatedStepIds);
        for (const stepId of escalatedStepIds) {
          appendMatterRunEvent(workspaceDir, {
            at,
            type: "wait_escalated",
            runId: run.runId,
            matterId: run.matterId,
            stepId,
            detail: "等待超时，进入待我拍板",
          });
        }
      });
    } catch {
      continue;
    }
  }
  return result;
}

export type MatterRunStepOutcome =
  | { status: "done"; outputRefs?: string[]; cursor?: unknown }
  | { status: "waiting"; wait: MatterRunWait }
  | { status: "failed"; error: string; retryable?: boolean }
  | { status: "skipped"; reason?: string };

export type MatterRunStepContext = {
  workspaceDir: string;
  run: MatterRun;
  step: MatterRunStep;
  at: string;
};

export type MatterRunStepExecutor = (
  ctx: MatterRunStepContext,
) => MatterRunStepOutcome | Promise<MatterRunStepOutcome>;

export type ResumeMatterRunsOptions = {
  executors?: Record<string, MatterRunStepExecutor>;
  at?: string | Date;
  matterId?: string;
  runId?: string;
  /** 单进程安全阀：一次 tick 最多推进多少步。默认 100。 */
  maxSteps?: number;
  /** 首次单实例启动时可强制接管；常规 tick 不要打开。 */
  forceRecover?: boolean;
};

export type ResumeMatterRunsResult = {
  runsVisited: number;
  stepsRun: number;
  waiting: number;
  failed: number;
  skipped: number;
  /** 有可执行步骤但本进程没注册执行器（保持 pending，不猜）。 */
  blocked: number;
  errors: string[];
};

type ClaimedStep = {
  run: MatterRun;
  step: MatterRunStep;
  attempts: number;
};

function claimNextStep(
  workspaceDir: string,
  matterId: string,
  runId: string,
  opts: { at: string; executors: Record<string, MatterRunStepExecutor>; forceRecover: boolean },
): { claimed?: ClaimedStep; blocked?: boolean; error?: string } {
  return withMatterRunLock(workspaceDir, matterId, runId, () => {
    let fresh = loadMatterRun(workspaceDir, matterId, runId, { tolerateCorrupt: true });
    if (!fresh || isTerminalMatterRunStatus(fresh.status)) {
      return {};
    }
    // 有 running 步骤：同进程/租约内说明正在执行，跳过；租约失效则接管。
    const runningSteps = fresh.steps.filter((s) => s.status === "running");
    if (runningSteps.length) {
      const active = runningSteps.some((s) => isMatterRunStepLeaseActive(s, { now: opts.at }));
      if (active && !opts.forceRecover) {
        return {};
      }
      const recovered = recoverInterruptedMatterRun(fresh, opts.at);
      fresh = recovered.run;
      if (recovered.recoveredStepIds.length || recovered.exhaustedStepIds.length) {
        saveMatterRun(workspaceDir, fresh);
        for (const stepId of recovered.recoveredStepIds) {
          appendMatterRunEvent(workspaceDir, {
            at: opts.at,
            type: "step_interrupted",
            runId: fresh.runId,
            matterId: fresh.matterId,
            stepId,
            detail: "租约失效，步骤回到待执行",
          });
        }
        for (const stepId of recovered.exhaustedStepIds) {
          appendMatterRunEvent(workspaceDir, {
            at: opts.at,
            type: "step_failed",
            runId: fresh.runId,
            matterId: fresh.matterId,
            stepId,
            detail: "attempts_exhausted",
          });
        }
      }
    }
    const step = nextRunnableMatterRunStep(fresh);
    if (!step || step.status !== "pending") {
      return {};
    }
    if (!opts.executors[step.kind]) {
      return { blocked: true };
    }
    if (step.attempts >= step.maxAttempts) {
      const failed = failMatterRunStep(fresh, step.stepId, {
        error: "attempts_exhausted",
        at: opts.at,
        retryable: false,
      });
      saveMatterRun(workspaceDir, failed);
      appendMatterRunEvent(workspaceDir, {
        at: opts.at,
        type: "step_failed",
        runId: failed.runId,
        matterId: failed.matterId,
        stepId: step.stepId,
        detail: "attempts_exhausted",
      });
      return {};
    }
    const claimedRun = startMatterRunStep(fresh, step.stepId, { at: opts.at });
    saveMatterRun(workspaceDir, claimedRun);
    const claimedStep = claimedRun.steps.find((s) => s.stepId === step.stepId)!;
    appendMatterRunEvent(workspaceDir, {
      at: opts.at,
      type: "step_started",
      runId: claimedRun.runId,
      matterId: claimedRun.matterId,
      stepId: step.stepId,
      attempts: claimedStep.attempts,
    });
    return { claimed: { run: claimedRun, step: claimedStep, attempts: claimedStep.attempts } };
  });
}

function finishStep(
  workspaceDir: string,
  claimed: ClaimedStep,
  outcome: MatterRunStepOutcome,
  at: string,
): void {
  withMatterRunLock(workspaceDir, claimed.run.matterId, claimed.run.runId, () => {
    const fresh = loadMatterRun(workspaceDir, claimed.run.matterId, claimed.run.runId, {
      tolerateCorrupt: true,
    });
    if (!fresh) {
      return;
    }
    const step = fresh.steps.find((s) => s.stepId === claimed.step.stepId);
    // 另一个进程已接管/完成这一尝试：丢弃本次结果，避免二次落状态。
    if (!step || step.status !== "running" || step.attempts !== claimed.attempts) {
      return;
    }
    switch (outcome.status) {
      case "done": {
        const next = completeMatterRunStep(fresh, step.stepId, {
          at,
          outputRefs: outcome.outputRefs,
          cursor: outcome.cursor,
        });
        saveMatterRun(workspaceDir, next);
        appendMatterRunEvent(workspaceDir, {
          at,
          type: "step_done",
          runId: next.runId,
          matterId: next.matterId,
          stepId: step.stepId,
          attempts: claimed.attempts,
          detail: outcome.outputRefs?.length ? `${outcome.outputRefs.length} 个输出` : undefined,
        });
        return;
      }
      case "waiting": {
        const next = waitMatterRunStep(fresh, step.stepId, outcome.wait, at);
        saveMatterRun(workspaceDir, next);
        appendMatterRunEvent(workspaceDir, {
          at,
          type: "step_waiting",
          runId: next.runId,
          matterId: next.matterId,
          stepId: step.stepId,
          detail: `${outcome.wait.reason}:${outcome.wait.eventKeys.join(",")}`,
        });
        return;
      }
      case "skipped": {
        const next = skipMatterRunStep(fresh, step.stepId, at);
        saveMatterRun(workspaceDir, next);
        appendMatterRunEvent(workspaceDir, {
          at,
          type: "step_skipped",
          runId: next.runId,
          matterId: next.matterId,
          stepId: step.stepId,
          detail: outcome.reason,
        });
        return;
      }
      case "failed": {
        const next = failMatterRunStep(fresh, step.stepId, {
          error: outcome.error,
          at,
          retryable: outcome.retryable,
        });
        saveMatterRun(workspaceDir, next);
        appendMatterRunEvent(workspaceDir, {
          at,
          type: "step_failed",
          runId: next.runId,
          matterId: next.matterId,
          stepId: step.stepId,
          attempts: claimed.attempts,
          detail: outcome.error,
        });
      }
    }
  });
}

/**
 * 推进可恢复的 run：领取 → 先落盘 → 执行 → 锁内复验后写回。
 *
 * 只有 `pending`/`running` 的 run 会被推进；`waiting` 必须由事件唤醒
 * （`wakeMatterRunsForEvent`）或超时升级，不由 tick 猜。
 */
export async function resumeMatterRuns(
  workspaceDir: string,
  opts: ResumeMatterRunsOptions = {},
): Promise<ResumeMatterRunsResult> {
  const at = iso(opts.at);
  const executors = opts.executors ?? {};
  const maxSteps = Math.max(1, opts.maxSteps ?? 100);
  const result: ResumeMatterRunsResult = {
    runsVisited: 0,
    stepsRun: 0,
    waiting: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    errors: [],
  };
  const candidates = listMatterRuns(workspaceDir, {
    ...(opts.matterId ? { matterId: opts.matterId } : {}),
    statuses: ["pending", "running"],
  }).filter((run) => !opts.runId || run.runId === opts.runId);

  for (const candidate of candidates) {
    result.runsVisited += 1;
    // 一个 run 在一次 tick 内连续推进，直到等待/完成/失败/缺执行器。
    while (result.stepsRun + result.waiting + result.failed + result.skipped < maxSteps) {
      let claim: ReturnType<typeof claimNextStep>;
      try {
        claim = claimNextStep(workspaceDir, candidate.matterId, candidate.runId, {
          at,
          executors,
          forceRecover: opts.forceRecover ?? false,
        });
      } catch (err) {
        result.errors.push(errorText(err));
        break;
      }
      if (claim.blocked) {
        result.blocked += 1;
        break;
      }
      if (!claim.claimed) {
        break;
      }
      result.stepsRun += 1;
      let outcome: MatterRunStepOutcome;
      try {
        const executor = executors[claim.claimed.step.kind];
        outcome = await executor({
          workspaceDir,
          run: claim.claimed.run,
          step: claim.claimed.step,
          at,
        });
      } catch (err) {
        outcome = { status: "failed", error: errorText(err) };
      }
      if (outcome.status === "waiting") {
        result.waiting += 1;
      } else if (outcome.status === "failed") {
        result.failed += 1;
      } else if (outcome.status === "skipped") {
        result.skipped += 1;
      }
      try {
        finishStep(workspaceDir, claim.claimed, outcome, at);
      } catch (err) {
        result.errors.push(errorText(err));
        break;
      }
      // 失败后不在同一 tick 里立刻重试：把重试留给下一轮（约 30s 退避），
      // 否则网络抖动会在一次扫描内把 maxAttempts 全部打光。
      if (outcome.status === "failed") {
        break;
      }
    }
  }
  return result;
}

export type TickMatterRunsResult = {
  recovered: RecoverInterruptedResult;
  escalated: EscalateWaitsResult;
  resumed: ResumeMatterRunsResult;
};

let ticking = false;

/**
 * 一个 tick 的完整动作：恢复中断 → 升级超时等待 → 推进可执行步骤。
 * 上一轮没跑完时直接跳过（与 intake tick 同一约定），避免同进程重入。
 */
export async function tickMatterRuns(
  workspaceDir: string,
  opts: ResumeMatterRunsOptions & { now?: string | Date } = {},
): Promise<TickMatterRunsResult | undefined> {
  if (ticking) {
    return undefined;
  }
  ticking = true;
  try {
    const at = iso(opts.now ?? opts.at);
    const recovered = recoverInterruptedMatterRuns(workspaceDir, {
      at,
      ...(opts.matterId ? { matterId: opts.matterId } : {}),
      ...(opts.forceRecover ? { force: true } : {}),
    });
    const escalated = escalateDueMatterRunWaits(workspaceDir, {
      at,
      ...(opts.matterId ? { matterId: opts.matterId } : {}),
    });
    const resumed = await resumeMatterRuns(workspaceDir, { ...opts, at });
    return { recovered, escalated, resumed };
  } finally {
    ticking = false;
  }
}

/** 「待我拍板」列表：超时未等到外部事件的等待步骤。 */
export function listEscalatedMatterRunWaits(
  workspaceDir: string,
  opts: { matterId?: string } = {},
): Array<{ run: MatterRun; step: MatterRunStep }> {
  const out: Array<{ run: MatterRun; step: MatterRunStep }> = [];
  for (const run of listMatterRuns(workspaceDir, {
    ...(opts.matterId ? { matterId: opts.matterId } : {}),
    statuses: ["waiting"],
  })) {
    for (const step of run.steps) {
      if (step.status === "waiting" && step.wait?.escalatedAt) {
        out.push({ run, step });
      }
    }
  }
  return out;
}

export type ResolveEscalatedMatterRunWaitInput = {
  matterId: string;
  runId: string;
  stepId: string;
  /** `extend`：把到期时间往后推；`skip`：不再等这一步，后续步骤照常。 */
  action: "extend" | "skip";
  /** 只对 `extend` 生效；缺省 {@link MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS}。 */
  days?: number;
  at?: string | Date;
};

export type MatterRunWaitDecisionFailure =
  | "run_not_found"
  | "step_not_found"
  | "step_not_waiting"
  | "step_not_escalated";

export type ResolveEscalatedMatterRunWaitResult =
  | { ok: true; run: MatterRun; step: MatterRunStep }
  | { ok: false; reason: MatterRunWaitDecisionFailure };

/**
 * 律师对「等待超时」的两种处理。
 *
 * 只接受**已升级**的等待步骤：普通等待还没有到拍板的时候，避免界面误点
 * 就把正常等待改成别的状态。两种处理都写事件流，谁在什么时候改了等待都可回放。
 */
export function resolveEscalatedMatterRunWait(
  workspaceDir: string,
  input: ResolveEscalatedMatterRunWaitInput,
): ResolveEscalatedMatterRunWaitResult {
  const at = iso(input.at);
  return withMatterRunLock(workspaceDir, input.matterId, input.runId, () => {
    const run = loadMatterRun(workspaceDir, input.matterId, input.runId, { tolerateCorrupt: true });
    if (!run) {
      return { ok: false, reason: "run_not_found" } as const;
    }
    const step = run.steps.find((s) => s.stepId === input.stepId);
    if (!step) {
      return { ok: false, reason: "step_not_found" } as const;
    }
    if (step.status !== "waiting" || !step.wait) {
      return { ok: false, reason: "step_not_waiting" } as const;
    }
    if (!step.wait.escalatedAt) {
      return { ok: false, reason: "step_not_escalated" } as const;
    }

    if (input.action === "skip") {
      const next = skipMatterRunStep(run, step.stepId, at);
      saveMatterRun(workspaceDir, next);
      appendMatterRunEvent(workspaceDir, {
        at,
        type: "step_skipped",
        runId: next.runId,
        matterId: next.matterId,
        stepId: step.stepId,
        detail: "律师决定不再等这一步",
      });
      return {
        ok: true,
        run: next,
        step: next.steps.find((s) => s.stepId === step.stepId)!,
      } as const;
    }

    const days = Math.min(
      MATTER_RUN_WAIT_EXTEND_MAX_DAYS,
      Math.max(
        1,
        Math.floor(
          Number.isFinite(input.days) && input.days
            ? input.days
            : MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS,
        ),
      ),
    );
    const until = new Date(Date.parse(at) + days * 86_400_000).toISOString();
    const next = extendMatterRunWait(run, step.stepId, { until, at });
    saveMatterRun(workspaceDir, next);
    appendMatterRunEvent(workspaceDir, {
      at,
      type: "wait_extended",
      runId: next.runId,
      matterId: next.matterId,
      stepId: step.stepId,
      detail: `律师再等 ${days} 天，到期 ${until}`,
    });
    return {
      ok: true,
      run: next,
      step: next.steps.find((s) => s.stepId === step.stepId)!,
    } as const;
  });
}

export type { MatterRun, MatterRunStatus, MatterRunStep, MatterRunWait };

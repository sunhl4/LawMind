/**
 * MatterRun — 一次案件生命周期里可恢复的步骤运行（纯状态机，不落盘）。
 *
 * 背景：`lawyer-automations-runner.ts` 只做「到期扫描 + 派单」，任务一旦出进程就停；
 * 等客户补件、等法院文书、等律师决定都只能靠内存 promise，重启即丢。
 * 这里补的是步骤语义（参照 12-factor-agents Factor 5/6、Inngest step 记忆化、DBOS checkpoint）：
 *
 * - 步骤有稳定 `stepId` 与 `idempotencyKey`；`done` 的步骤重启后不再执行。
 * - 「等待」是持久状态 `wait { reason, eventKeys, dueAt }`，不是 sleep。
 * - `running` 步骤带租约（ownerPid + leaseUntil），崩溃后由恢复入口接管。
 *
 * 边界：MatterRun 只存**执行状态**；案件真相源仍是 `matter.json` 与案件目录。
 * 本文件不碰文件系统，落盘与锁见 `matter-run-store.ts`。
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";

export const MATTER_RUN_SCHEMA_VERSION = 1;

/** 等待原因：等客户补件、等对方回函、等法院文书、等律师拍板、其它外部事件。 */
export const MATTER_RUN_WAIT_REASONS = [
  "client_documents",
  "counterparty_response",
  "court_filing",
  "lawyer_decision",
  "external_event",
] as const;

export const MatterRunWaitReasonSchema = z.enum(MATTER_RUN_WAIT_REASONS);
export type MatterRunWaitReason = z.infer<typeof MatterRunWaitReasonSchema>;

export const MatterRunStepStatusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "done",
  "failed",
  "skipped",
]);
export type MatterRunStepStatus = z.infer<typeof MatterRunStepStatusSchema>;

export const MatterRunStatusSchema = z.enum(["pending", "running", "waiting", "done", "failed"]);
export type MatterRunStatus = z.infer<typeof MatterRunStatusSchema>;

export const MatterRunWaitSchema = z.object({
  reason: MatterRunWaitReasonSchema,
  /**
   * 唤醒键。约定：
   *   `intake:<intakeItemId>`  某条来件入库
   *   `thread:<threadKey>`     某个邮件线程有新消息
   *   `matter:<matterId>`      该案件有新材料归档
   *   `*`                      任意事件（慎用）
   */
  eventKeys: z.array(z.string().min(1).max(200)).max(20),
  /** 到期时间；超时后升级为律师待办，而不是静默卡住。 */
  dueAt: z.string().optional(),
  /** 已升级时间；非空表示已进入「待我拍板」。 */
  escalatedAt: z.string().optional(),
});
export type MatterRunWait = z.infer<typeof MatterRunWaitSchema>;

export const MatterRunStepSchema = z.object({
  stepId: z.string().min(1).max(128),
  /** 执行器键（由调用方注册）；恢复时找不到执行器就停在 pending，不猜。 */
  kind: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
  status: MatterRunStepStatusSchema,
  /** 同一 run 内唯一。副作用执行器必须用它做去重（外发、渲染、写交付物）。 */
  idempotencyKey: z.string().min(1).max(256),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  /** 步骤输入引用（案件相对路径 / 来件 id / 草稿 id），用于回放。 */
  inputRefs: z.array(z.string().max(1024)).max(200).optional(),
  /** 步骤输出引用；`done` 后只读。 */
  outputRefs: z.array(z.string().max(1024)).max(200).optional(),
  /** 执行器自定义游标（分页、批号等），必须是可 JSON 序列化的值。 */
  cursor: z.unknown().optional(),
  wait: MatterRunWaitSchema.optional(),
  /** 最近一次失败原因（重试成功后保留，便于观测）。 */
  error: z.string().max(2000).optional(),
  /** 当前持有执行权的进程；用于崩溃后判定租约。 */
  ownerPid: z.number().int().positive().optional(),
  /** 租约到期时间；到期后允许其它进程接管。 */
  leaseUntil: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type MatterRunStep = z.infer<typeof MatterRunStepSchema>;

export const MatterRunSchema = z.object({
  schemaVersion: z.literal(MATTER_RUN_SCHEMA_VERSION),
  runId: z.string().min(1).max(128),
  matterId: z.string().min(1).max(128),
  title: z.string().max(200).optional(),
  status: MatterRunStatusSchema,
  steps: z.array(MatterRunStepSchema).min(1).max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type MatterRun = z.infer<typeof MatterRunSchema>;

export type MatterRunStepInput = {
  /** 省略时按顺序生成 `s1`、`s2`…；恢复与幂等依赖它，创建后不要改。 */
  stepId?: string;
  kind: string;
  title?: string;
  /** 省略时生成 `<runId>:<stepId>`。 */
  idempotencyKey?: string;
  maxAttempts?: number;
  inputRefs?: string[];
};

export type CreateMatterRunInput = {
  matterId: string;
  runId?: string;
  title?: string;
  steps: MatterRunStepInput[];
  /** 注入时钟，测试用。 */
  at?: string | Date;
};

function iso(at?: string | Date): string {
  if (!at) {
    return new Date().toISOString();
  }
  return typeof at === "string" ? at : at.toISOString();
}

export function makeMatterRunId(at?: string | Date): string {
  const stamp = iso(at)
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `run_${stamp}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function isTerminalMatterRunStatus(status: MatterRunStatus): boolean {
  return status === "done" || status === "failed";
}

function cloneStep(step: MatterRunStep): MatterRunStep {
  return {
    ...step,
    ...(step.inputRefs ? { inputRefs: [...step.inputRefs] } : {}),
    ...(step.outputRefs ? { outputRefs: [...step.outputRefs] } : {}),
    ...(step.wait ? { wait: { ...step.wait, eventKeys: [...step.wait.eventKeys] } } : {}),
  };
}

function cloneRun(run: MatterRun): MatterRun {
  return { ...run, steps: run.steps.map(cloneStep) };
}

/** 由步骤状态推导 run 状态。终态只由「全部步骤终止」决定，不由调用方手写。 */
export function deriveMatterRunStatus(steps: readonly MatterRunStep[]): MatterRunStatus {
  if (steps.some((s) => s.status === "running")) {
    return "running";
  }
  if (steps.some((s) => s.status === "failed")) {
    return "failed";
  }
  if (steps.some((s) => s.status === "waiting")) {
    return "waiting";
  }
  if (steps.some((s) => s.status === "pending")) {
    return "pending";
  }
  return "done";
}

function touch(run: MatterRun, at: string): MatterRun {
  const status = deriveMatterRunStatus(run.steps);
  return {
    ...run,
    status,
    updatedAt: at,
    ...(isTerminalMatterRunStatus(status) ? { finishedAt: run.finishedAt ?? at } : {}),
  };
}

export function createMatterRun(input: CreateMatterRunInput): MatterRun {
  const at = iso(input.at);
  const runId = input.runId?.trim() || makeMatterRunId(at);
  if (!input.steps.length) {
    throw new Error("matter_run_requires_steps");
  }
  const seenStepIds = new Set<string>();
  const seenKeys = new Set<string>();
  const steps: MatterRunStep[] = input.steps.map((raw, i) => {
    const stepId = raw.stepId?.trim() || `s${i + 1}`;
    if (seenStepIds.has(stepId)) {
      throw new Error(`duplicate_step_id:${stepId}`);
    }
    seenStepIds.add(stepId);
    const idempotencyKey = raw.idempotencyKey?.trim() || `${runId}:${stepId}`;
    if (seenKeys.has(idempotencyKey)) {
      throw new Error(`duplicate_idempotency_key:${idempotencyKey}`);
    }
    seenKeys.add(idempotencyKey);
    return {
      stepId,
      kind: raw.kind,
      status: "pending",
      idempotencyKey,
      attempts: 0,
      maxAttempts: raw.maxAttempts ?? 3,
      ...(raw.title ? { title: raw.title } : {}),
      ...(raw.inputRefs?.length ? { inputRefs: [...raw.inputRefs] } : {}),
      updatedAt: at,
    };
  });
  const run: MatterRun = {
    schemaVersion: MATTER_RUN_SCHEMA_VERSION,
    runId,
    matterId: input.matterId,
    ...(input.title ? { title: input.title } : {}),
    status: "pending",
    steps,
    createdAt: at,
    updatedAt: at,
  };
  return touch(run, at);
}

export function findMatterRunStep(run: MatterRun, stepId: string): MatterRunStep | undefined {
  return run.steps.find((s) => s.stepId === stepId);
}

/** 下一个可执行步骤：严格按顺序，前面的步骤未终止就不跳步。 */
export function nextRunnableMatterRunStep(run: MatterRun): MatterRunStep | undefined {
  for (const step of run.steps) {
    if (step.status === "done" || step.status === "skipped") {
      continue;
    }
    if (step.status === "failed") {
      return undefined;
    }
    if (step.status === "running") {
      return step;
    }
    if (step.status === "waiting") {
      // 等外部事件：后面的步骤不得抢跑。
      return undefined;
    }
    return step;
  }
  return undefined;
}

export type StartMatterRunStepOptions = {
  at?: string | Date;
  /** 租约时长；崩溃后超过租约允许接管。默认 2 分钟。 */
  leaseMs?: number;
  ownerPid?: number;
};

/**
 * 领取步骤执行权：`pending → running`，`attempts + 1`，写租约。
 * 调用方必须先把返回的 run 落盘，再执行副作用（intent-before-effect）。
 */
export function startMatterRunStep(
  run: MatterRun,
  stepId: string,
  opts: StartMatterRunStepOptions = {},
): MatterRun {
  const at = iso(opts.at);
  const leaseMs = Math.max(1_000, opts.leaseMs ?? 2 * 60_000);
  const ownerPid = opts.ownerPid ?? process.pid;
  const next = cloneRun(run);
  const step = next.steps.find((s) => s.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_step:${stepId}`);
  }
  if (step.status !== "pending" && step.status !== "running") {
    throw new Error(`step_not_runnable:${stepId}:${step.status}`);
  }
  if (step.attempts >= step.maxAttempts) {
    throw new Error(`step_attempts_exhausted:${stepId}`);
  }
  step.status = "running";
  step.attempts += 1;
  step.ownerPid = ownerPid;
  step.leaseUntil = new Date(Date.parse(at) + leaseMs).toISOString();
  step.startedAt = step.startedAt ?? at;
  step.updatedAt = at;
  delete step.wait;
  return touch(next, at);
}

export type CompleteMatterRunStepInput = {
  at?: string | Date;
  outputRefs?: string[];
  cursor?: unknown;
};

/** `running → done`；输出引用写回后即为该步骤的备忘录（重跑一律跳过）。 */
export function completeMatterRunStep(
  run: MatterRun,
  stepId: string,
  input: CompleteMatterRunStepInput = {},
): MatterRun {
  const at = iso(input.at);
  const next = cloneRun(run);
  const step = next.steps.find((s) => s.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_step:${stepId}`);
  }
  step.status = "done";
  step.finishedAt = at;
  step.updatedAt = at;
  delete step.error;
  delete step.wait;
  delete step.ownerPid;
  delete step.leaseUntil;
  if (input.outputRefs?.length) {
    step.outputRefs = [...input.outputRefs];
  }
  if (input.cursor !== undefined) {
    step.cursor = input.cursor;
  }
  return touch(next, at);
}

export function skipMatterRunStep(run: MatterRun, stepId: string, at?: string | Date): MatterRun {
  const stamp = iso(at);
  const next = cloneRun(run);
  const step = next.steps.find((s) => s.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_step:${stepId}`);
  }
  step.status = "skipped";
  step.finishedAt = stamp;
  step.updatedAt = stamp;
  delete step.wait;
  delete step.ownerPid;
  delete step.leaseUntil;
  return touch(next, stamp);
}

export type FailMatterRunStepInput = {
  error: string;
  at?: string | Date;
  /** 可重试且未到上限时回到 pending。默认 true。 */
  retryable?: boolean;
};

export function failMatterRunStep(
  run: MatterRun,
  stepId: string,
  input: FailMatterRunStepInput,
): MatterRun {
  const at = iso(input.at);
  const next = cloneRun(run);
  const step = next.steps.find((s) => s.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_step:${stepId}`);
  }
  const retryable = input.retryable ?? true;
  step.error = input.error.slice(0, 2000);
  step.updatedAt = at;
  delete step.ownerPid;
  delete step.leaseUntil;
  if (retryable && step.attempts < step.maxAttempts) {
    step.status = "pending";
  } else {
    step.status = "failed";
    step.finishedAt = at;
  }
  return touch(next, at);
}

/** `running → waiting`：等待是持久状态，不是 sleep。 */
export function waitMatterRunStep(
  run: MatterRun,
  stepId: string,
  wait: MatterRunWait,
  at?: string | Date,
): MatterRun {
  const stamp = iso(at);
  const next = cloneRun(run);
  const step = next.steps.find((s) => s.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_step:${stepId}`);
  }
  if (!wait.eventKeys.length) {
    throw new Error(`wait_requires_event_keys:${stepId}`);
  }
  step.status = "waiting";
  step.wait = { ...wait, eventKeys: [...wait.eventKeys] };
  step.updatedAt = stamp;
  delete step.ownerPid;
  delete step.leaseUntil;
  return touch(next, stamp);
}

export type WakeMatterRunResult = {
  run: MatterRun;
  wokeStepIds: string[];
};

/**
 * 外部事件命中 `wait.eventKeys` → 等待步骤回到 pending。
 * `*` 只匹配显式登记的通配等待，不做隐式全局广播。
 */
export function wakeMatterRunForEvent(
  run: MatterRun,
  eventKey: string,
  at?: string | Date,
): WakeMatterRunResult {
  const stamp = iso(at);
  const next = cloneRun(run);
  const wokeStepIds: string[] = [];
  for (const step of next.steps) {
    if (step.status !== "waiting" || !step.wait) {
      continue;
    }
    if (!step.wait.eventKeys.includes(eventKey) && !step.wait.eventKeys.includes("*")) {
      continue;
    }
    step.status = "pending";
    step.updatedAt = stamp;
    delete step.wait;
    wokeStepIds.push(step.stepId);
  }
  return { run: wokeStepIds.length ? touch(next, stamp) : run, wokeStepIds };
}

/**
 * 超时的等待升级为律师待办：保留 `waiting`（外部事件仍可唤醒），
 * 但打上 `escalatedAt`，让「待我拍板」能列出来。
 */
export function escalateDueWaitSteps(
  run: MatterRun,
  opts: { now?: string | Date } = {},
): { run: MatterRun; escalatedStepIds: string[] } {
  const now = iso(opts.now);
  const nowMs = Date.parse(now);
  const next = cloneRun(run);
  const escalatedStepIds: string[] = [];
  for (const step of next.steps) {
    if (step.status !== "waiting" || !step.wait?.dueAt || step.wait.escalatedAt) {
      continue;
    }
    const due = Date.parse(step.wait.dueAt);
    if (!Number.isFinite(due) || due > nowMs) {
      continue;
    }
    step.wait.escalatedAt = now;
    step.updatedAt = now;
    escalatedStepIds.push(step.stepId);
  }
  return { run: escalatedStepIds.length ? touch(next, now) : run, escalatedStepIds };
}

export function isMatterRunWaitEscalated(step: MatterRunStep): boolean {
  return step.status === "waiting" && Boolean(step.wait?.escalatedAt);
}

export type ExtendMatterRunWaitInput = {
  /** 新的到期时间；「几天」是产品口径，由调用方算好再传进来。 */
  until: string | Date;
  at?: string | Date;
};

/**
 * 律师决定「再等一段」：把 `dueAt` 往后推，并清掉 `escalatedAt`。
 *
 * 仍保持 `waiting`——外部事件提前到达照样能唤醒，不等同于重新执行步骤。
 */
export function extendMatterRunWait(
  run: MatterRun,
  stepId: string,
  input: ExtendMatterRunWaitInput,
): MatterRun {
  const stamp = iso(input.at);
  const until = iso(input.until);
  if (!Number.isFinite(Date.parse(until))) {
    throw new Error(`invalid_wait_until:${stepId}`);
  }
  const next = cloneRun(run);
  const step = next.steps.find((s) => s.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_step:${stepId}`);
  }
  if (step.status !== "waiting" || !step.wait) {
    throw new Error(`step_not_waiting:${stepId}`);
  }
  step.wait = { ...step.wait, dueAt: until };
  delete step.wait.escalatedAt;
  step.updatedAt = stamp;
  return touch(next, stamp);
}

/** 判断进程是否还活着：ESRCH = 已退出；EPERM = 活着但无权限（按活着处理）。 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 租约是否仍有效（同进程、持有进程仍存活且未过期）。 */
export function isMatterRunStepLeaseActive(
  step: MatterRunStep,
  opts: { now?: string | Date; pid?: number } = {},
): boolean {
  if (step.status !== "running") {
    return false;
  }
  const pid = opts.pid ?? process.pid;
  if (step.ownerPid === pid) {
    return true;
  }
  // 同机工作区：持有进程已退出，租约立刻失效，不必等满租约时长。
  if (step.ownerPid !== undefined && !isPidAlive(step.ownerPid)) {
    return false;
  }
  if (!step.leaseUntil) {
    return false;
  }
  const until = Date.parse(step.leaseUntil);
  return Number.isFinite(until) && until > Date.parse(iso(opts.now));
}

/**
 * 进程崩溃后的恢复：`running` 步骤回到 `pending`（已做租约判定的调用方才可强制）。
 * 尝试次数已满的步骤直接失败，避免崩溃循环无限重放。
 */
export function recoverInterruptedMatterRun(
  run: MatterRun,
  at?: string | Date,
): { run: MatterRun; recoveredStepIds: string[]; exhaustedStepIds: string[] } {
  const stamp = iso(at);
  const next = cloneRun(run);
  const recoveredStepIds: string[] = [];
  const exhaustedStepIds: string[] = [];
  for (const step of next.steps) {
    if (step.status !== "running") {
      continue;
    }
    delete step.ownerPid;
    delete step.leaseUntil;
    step.updatedAt = stamp;
    if (step.attempts >= step.maxAttempts) {
      step.status = "failed";
      step.error = step.error ?? "attempts_exhausted";
      step.finishedAt = stamp;
      exhaustedStepIds.push(step.stepId);
    } else {
      step.status = "pending";
      recoveredStepIds.push(step.stepId);
    }
  }
  return {
    run: recoveredStepIds.length || exhaustedStepIds.length ? touch(next, stamp) : run,
    recoveredStepIds,
    exhaustedStepIds,
  };
}

export type MatterRunProgress = {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  waiting: number;
  pending: number;
  running: number;
  /** 已升级为律师待办的等待步骤。 */
  escalated: number;
};

export function matterRunProgress(run: MatterRun): MatterRunProgress {
  const progress: MatterRunProgress = {
    total: run.steps.length,
    done: 0,
    skipped: 0,
    failed: 0,
    waiting: 0,
    pending: 0,
    running: 0,
    escalated: 0,
  };
  for (const step of run.steps) {
    progress[step.status] += 1;
    if (isMatterRunWaitEscalated(step)) {
      progress.escalated += 1;
    }
  }
  return progress;
}

/** 只读快照：给界面 / 日志用，避免调用方直接改内部数组。 */
export function snapshotMatterRun(run: MatterRun): MatterRun {
  return cloneRun(run);
}

/**
 * lawmindd 监督决策（纯函数，便于单测）。
 *
 * 背景：`lawmindd` 是「关掉桌面之后仍然替你办件」的那个进程。它此前是
 * 一发即弃的（`stdio: "ignore"` + `unref()`），崩了没人知道、也没人拉起。
 * 本模块只负责**判断**：这次退出算不算意外、该不该重启、退避多久、什么时候放弃。
 * 真正 fork 子进程的副作用在 `apps/lawmind-desktop/server/lawmind-local-server.ts`。
 *
 * 与 `apps/lawmind-desktop/electron/server-supervision.mjs`（本地服务器子进程监督）
 * 保持同一套退避形状：确定性、无抖动，便于日志与测试对齐。
 */

export const DAEMON_SUPERVISION_DEFAULTS = Object.freeze({
  baseDelayMs: 500,
  factor: 2,
  maxDelayMs: 30_000,
  maxAttempts: 5,
});

export type DaemonSupervisionOptions = Partial<typeof DAEMON_SUPERVISION_DEFAULTS>;

/** 退出分类。只有 `crashed` / `killed` 会触发重启。 */
export type DaemonExitClass = "clean" | "crashed" | "killed" | "stopped";

export type DaemonExitInput = {
  code?: number | null;
  signal?: string | null;
  /** 监督进程自己要求停（桌面打开、用户点了停、进程收到 SIGTERM）。 */
  intentional?: boolean;
};

/**
 * 把一次退出归类。
 * - `intentional` 优先：这是「正常停止」，永不重启。
 * - SIGTERM / SIGINT：等价于正常停止（`stopDaemonProcess` 走的就是 SIGTERM）。
 * - 其它信号（SIGKILL / SIGSEGV / SIGABRT / OOM）：被外力杀死，要重启。
 * - `code === 0`：它自己决定收工（例如发现已有实例在跑），不重启。
 * - 其余非零码：崩溃，要重启。
 */
export function classifyDaemonExit(input: DaemonExitInput): DaemonExitClass {
  if (input.intentional === true) {
    return "stopped";
  }
  const signal = input.signal ?? null;
  if (signal === "SIGTERM" || signal === "SIGINT") {
    return "stopped";
  }
  if (signal) {
    return "killed";
  }
  if (input.code === 0) {
    return "clean";
  }
  return "crashed";
}

function resolveOptions(opts?: DaemonSupervisionOptions) {
  return { ...DAEMON_SUPERVISION_DEFAULTS, ...opts };
}

/** 第 attempt 次（1 起）重启前的退避毫秒：base * factor^(attempt-1)，封顶 maxDelay。 */
export function computeDaemonRestartDelayMs(
  attempt: number,
  opts?: DaemonSupervisionOptions,
): number {
  const { baseDelayMs, factor, maxDelayMs } = resolveOptions(opts);
  const n = Math.max(1, Math.floor(attempt) || 1);
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, n - 1));
}

/** 是否还允许第 attempt 次重启（attempt > maxAttempts 时放弃）。 */
export function shouldRestartDaemon(attempt: number, opts?: DaemonSupervisionOptions): boolean {
  const { maxAttempts } = resolveOptions(opts);
  const n = Math.max(1, Math.floor(attempt) || 1);
  return n <= maxAttempts;
}

export type DaemonSupervisionDecision =
  | { action: "none"; reason: string }
  | { action: "restart"; attempt: number; delayMs: number; reason: string }
  | { action: "give_up"; reason: string };

/**
 * 单点决策：给定退出分类与已重启次数，下一步做什么。
 * 把它做成纯函数，是为了让「什么时候该放弃」这条容易写错的规则只有一个实现。
 */
export function decideDaemonSupervision(input: {
  exitClass: DaemonExitClass;
  attempt: number;
  opts?: DaemonSupervisionOptions;
}): DaemonSupervisionDecision {
  const { exitClass, attempt, opts } = input;
  if (exitClass === "stopped") {
    return { action: "none", reason: "intentional_stop" };
  }
  if (exitClass === "clean") {
    return { action: "none", reason: "clean_exit" };
  }
  if (!shouldRestartDaemon(attempt, opts)) {
    return {
      action: "give_up",
      reason: `restart_limit_reached:${(Math.floor(attempt) || 1) - 1}`,
    };
  }
  const n = Math.max(1, Math.floor(attempt) || 1);
  return {
    action: "restart",
    attempt: n,
    delayMs: computeDaemonRestartDelayMs(n, opts),
    reason: exitClass === "killed" ? "killed_by_signal" : "crashed",
  };
}

/**
 * 给律师看的一句话。用于设置页与「你走后发生了什么」回执。
 * 刻意不出现 pid / signal 名 / exit code——那些进日志，不进律师的界面。
 */
export function describeDaemonExitForLawyer(
  exitClass: DaemonExitClass,
  input: DaemonExitInput = {},
): string {
  if (exitClass === "stopped") {
    return "后台办件已正常停止。";
  }
  if (exitClass === "clean") {
    return "后台办件自己收工了。";
  }
  if (exitClass === "killed") {
    return "后台办件被这台电脑强制结束（常见于系统休眠或内存不足），已自动重启。";
  }
  return typeof input.code === "number"
    ? `后台办件意外中断（退出码 ${input.code}），已自动重启。`
    : "后台办件意外中断，已自动重启。";
}

/** 放弃监督时给律师看的一句话。 */
export function describeDaemonGiveUpForLawyer(reason: string, attempts: number): string {
  return `后台办件连续失败 ${attempts} 次后已停止重试。这段时间的自动办件没有运行，请打开桌面查看日志后再决定是否继续。`;
}

/** 只认「放弃重试」与「心跳过期」。自动恢复不打扰。 */
export function shouldNotifyDaemonIncident(status: {
  supervisionGaveUp?: boolean;
  heartbeatStale?: boolean;
}): boolean {
  return Boolean(status.supervisionGaveUp) || Boolean(status.heartbeatStale);
}

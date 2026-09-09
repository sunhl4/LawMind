/**
 * 本地服务器进程级崩溃策略（计数 + 健康信号；handler 本体在 lawmind-local-server.ts）。
 *
 * 取舍说明（二选一的明确化）：
 * - uncaughtException：同步执行栈状态可能已损坏，带病继续风险不可控 —— 记录后干净退出，
 *   由 Electron 监督层指数退避重启（electron/local-server.mjs）；daemon 模式无监督层，
 *   残留 pid 由 isDaemonPidAlive 探测，下次桌面会话自愈。
 * - unhandledRejection：本服务存在大量 best-effort 后台任务（索引重建、自动化 tick、
 *   外部模型/邮件请求），孤立 rejection 多为单任务失败而非进程级损坏 —— 可用性优先，
 *   记录并计入健康信号（/api/health → doctor.process.degraded），不退出进程。
 */

export type ProcessHealthSignals = {
  uncaughtExceptions: number;
  unhandledRejections: number;
  /** 任一异常信号非零即恶化：监督层/前端可据此提示重启或上报。 */
  degraded: boolean;
};

const counters = { uncaughtExceptions: 0, unhandledRejections: 0 };

export function noteUncaughtException(): void {
  counters.uncaughtExceptions += 1;
}

export function noteUnhandledRejection(): void {
  counters.unhandledRejections += 1;
}

export function getProcessHealthSignals(): ProcessHealthSignals {
  return {
    uncaughtExceptions: counters.uncaughtExceptions,
    unhandledRejections: counters.unhandledRejections,
    degraded: counters.uncaughtExceptions > 0 || counters.unhandledRejections > 0,
  };
}

/** Test-only: 清零健康信号计数。 */
export function resetProcessHealthSignalsForTests(): void {
  counters.uncaughtExceptions = 0;
  counters.unhandledRejections = 0;
}

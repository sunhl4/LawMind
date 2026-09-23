/**
 * lawmindd 监督循环。
 *
 * 背景：桌面关窗后，`lawmindd` 是唯一还在替律师办件的进程。它此前是一发即弃的
 * （spawn 时 `stdio: "ignore"` + `unref()`），崩了没人拉起，也没人知道。
 *
 * 结构：**监督进程持有 pid 文件与单实例锁，子进程跑 tick 循环。**
 * 之所以要两层的代价，是为了拿到「子进程怎么死都能重启」——包括 SIGKILL / OOM
 * 这种进程自己没机会反应的死法。若把重启逻辑写在 tick 进程内，它自己被杀就一起没了。
 *
 * 本模块只做循环编排，副作用（真正 spawn、真正 sleep）由调用方注入，
 * 因此单测可以精确断言「重启了几次、第几次之后放弃」。
 */

import {
  classifyDaemonExit,
  decideDaemonSupervision,
  type DaemonExitClass,
  type DaemonSupervisionOptions,
} from "../../../src/lawmind/platform/lawmind-daemon-supervision.js";
import { buildDaemonProcessEnv } from "../../../src/lawmind/platform/lawmind-daemon.js";

export type DaemonChildExit = {
  code: number | null;
  signal: string | null;
};

export type DaemonSupervisorHooks = {
  /**
   * 起一个子进程并返回它的退出承诺。
   *
   * `restartCount` 是**本进程之前已经重启过几次**（首次启动为 0），
   * 监督进程据此通过 `LAWMIND_DAEMON_RESTART_COUNT` 告诉子进程——子进程再把它
   * 写进 `daemon.json`，桌面重开时的「期间中断过 N 次」回执就来自这个数。
   * 把它放进 hook 参数而不是让调用方自己数，是为了让这条接线可被单测断言
   * （曾经漏过：子进程永远收到 0，回执因此永远不出现）。
   */
  spawnChild: (info: { restartCount: number }) => { waitForExit: () => Promise<DaemonChildExit> };
  /** 可注入的 sleep，便于测试不真等。 */
  delay: (ms: number) => Promise<void>;
  /** 每次子进程退出（含正常停止）都会回调，供写日志/写状态。 */
  onChildExit?: (info: {
    exitClass: DaemonExitClass;
    code: number | null;
    signal: string | null;
    /** 这次退出之后累计重启了几次。 */
    restarts: number;
  }) => void;
  /** 准备重启时的回调，供写日志。 */
  onRestartScheduled?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  /** 放弃时的回调，供把「不会再办件了」写进状态与日志。 */
  onGiveUp?: (info: { reason: string; attempts: number }) => void;
};

export type DaemonSupervisorOutcome = {
  /** 循环终止原因：正常停止、自然收工、或重试预算用尽。 */
  reason: string;
  /** 终止前累计自动重启次数。 */
  restarts: number;
  /** 最后一次子进程退出分类。 */
  lastExitClass: DaemonExitClass | null;
  gaveUp: boolean;
};

export type DaemonSupervisorOptions = {
  supervision?: DaemonSupervisionOptions;
  /** 外部要求停止（SIGTERM / 桌面打开 / 用户点停）。 */
  isStopping?: () => boolean;
};

/**
 * 跑到子进程正常收工、被要求停止、或重试预算用尽为止。
 * 本函数不负责杀子进程——调用方在 `isStopping()` 为真时负责收尾。
 */
export async function runDaemonSupervisorLoop(
  hooks: DaemonSupervisorHooks,
  opts: DaemonSupervisorOptions = {},
): Promise<DaemonSupervisorOutcome> {
  const isStopping = opts.isStopping ?? (() => false);
  let restarts = 0;
  let lastExitClass: DaemonExitClass | null = null;

  for (;;) {
    const { waitForExit } = hooks.spawnChild({ restartCount: restarts });
    const exit = await waitForExit();
    const exitClass = classifyDaemonExit({
      code: exit.code,
      signal: exit.signal,
      intentional: isStopping(),
    });
    lastExitClass = exitClass;
    hooks.onChildExit?.({
      exitClass,
      code: exit.code,
      signal: exit.signal,
      restarts,
    });

    const decision = decideDaemonSupervision({
      exitClass,
      attempt: restarts + 1,
      opts: opts.supervision,
    });

    if (decision.action === "none") {
      return { reason: decision.reason, restarts, lastExitClass, gaveUp: false };
    }
    if (decision.action === "give_up") {
      hooks.onGiveUp?.({ reason: decision.reason, attempts: restarts });
      return { reason: decision.reason, restarts, lastExitClass, gaveUp: true };
    }

    hooks.onRestartScheduled?.({
      attempt: decision.attempt,
      delayMs: decision.delayMs,
      reason: decision.reason,
    });
    await hooks.delay(decision.delayMs);
    if (isStopping()) {
      return { reason: "intentional_stop", restarts, lastExitClass, gaveUp: false };
    }
    restarts = decision.attempt;
  }
}

/** 给日志用的一行人类可读描述（工程侧，不面向律师）。 */
export function describeDaemonChildExitForLog(exit: DaemonChildExit): string {
  if (exit.signal) {
    return `signal=${exit.signal}`;
  }
  return `exit_code=${exit.code ?? "unknown"}`;
}

/**
 * 监督进程 fork tick 子进程时用的 env。
 *
 * 这是一条**安全不变式**，不只是省几行：tick 进程不监听任何端口，
 * 因此没有理由持有 loopback 凭据（`LAWMIND_LOCAL_API_TOKEN`、
 * `LAWMIND_SKIP_API_AUTH`）或派生凭据根密钥
 * （`LAWMIND_LOCAL_API_INSTALLATION_SECRET` / `_EPOCH` / `_REVOKED_CLIENTS` /
 * `_INSTANCE_ID`）。
 *
 * 必须走 `buildDaemonProcessEnv` 这个唯一过滤器——**不能**手写
 * `{...process.env}`：那样会把 deny 名单里的键原样透传给子进程，
 * 而这个错误在本地跑起来时完全看不出来。
 */
export function buildSupervisorChildEnv(
  source: NodeJS.ProcessEnv,
  opts: { workspaceDir: string; envFile?: string },
): NodeJS.ProcessEnv {
  const env = buildDaemonProcessEnv(source, {
    LAWMIND_WORKSPACE_DIR: opts.workspaceDir,
    LAWMIND_ENV_FILE: opts.envFile ?? "",
  });
  // 子进程是 tick 进程，不是监督进程；去掉标志避免递归 fork。
  env.LAWMIND_DAEMON = "1";
  delete env.LAWMIND_DAEMON_SUPERVISOR;
  return env;
}

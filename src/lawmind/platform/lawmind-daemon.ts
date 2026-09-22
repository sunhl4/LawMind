/**
 * Local lawmindd — keep automations ticking after the desktop window closes.
 * One workspace, one pid file. Not a cloud VM.
 *
 * 「可信后台」的四件套（见 docs/LAWMIND-STRATEGY-MASTER.md §11）：
 * - **心跳**：`heartbeatAt` 每 tick 刷新，读侧给出 `heartbeatStale`，
 *   让「进程还在但循环卡死」与「进程没了」可区分。
 * - **退出记录**：崩溃/被杀之后留下 `lastExitClass`，桌面重开时如实告诉律师。
 * - **重启计数 / 放弃**：监督进程连续失败后停止重试，并把这件事写进状态，
 *   而不是无声地永远不再办件。
 * - **单实例锁**：pid 文件只用于「谁在跑」，抢锁才是互斥依据，
 *   消除「读 pid → 判定可启动 → 写 pid」之间的竞态。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import {
  describeDaemonExitForLawyer,
  describeDaemonGiveUpForLawyer,
  type DaemonExitClass,
} from "./lawmind-daemon-supervision.js";

export const DAEMON_DIR = "lawmind";
export const DAEMON_STATE_FILE = "daemon.json";
export const DAEMON_PID_FILE = "daemon.pid";
export const DAEMON_LOCK_FILE = "daemon.lock";

/** 后台 tick 间隔。桌面侧与守护侧共用这一个常量，避免两处各写 30_000。 */
export const DAEMON_TICK_INTERVAL_MS = 30_000;

/**
 * 心跳过期阈值：3 个 tick。取 3 而不是 1，是为了容忍一次慢 tick
 * （例如大案卷的邮件同步）而不误报「卡死」。
 */
export const DAEMON_HEARTBEAT_STALE_MS = DAEMON_TICK_INTERVAL_MS * 3;

export type LawmindDaemonState = {
  enabled: boolean;
  pid?: number;
  startedAt?: string;
  lastTickAt?: string;
  /** 最近一次心跳（与 tick 同频）。 */
  heartbeatAt?: string;
  /** 累计监督重启次数（正常启动清零）。 */
  restartCount?: number;
  lastExitClass?: DaemonExitClass;
  lastExitAt?: string;
  /** 工程侧细节（退出码/信号），只进日志与 Doctor，不进律师主界面文案。 */
  lastExitDetail?: string;
  supervisionGaveUpAt?: string;
  supervisionGaveUpReason?: string;
  supervisionGaveUpAttempts?: number;
};

export type LawmindDaemonStatus = {
  enabled: boolean;
  running: boolean;
  pid?: number;
  startedAt?: string;
  lastTickAt?: string;
  heartbeatAt?: string;
  /** 心跳距今毫秒；无心跳记录时为 undefined。 */
  heartbeatAgeMs?: number;
  /** 进程活着但心跳过期 = 循环卡死。进程已死时为 false（由 running 表达）。 */
  heartbeatStale?: boolean;
  restartCount?: number;
  lastExitClass?: DaemonExitClass;
  lastExitAt?: string;
  lastExitDetail?: string;
  supervisionGaveUp?: boolean;
  supervisionGaveUpReason?: string;
  supervisionGaveUpAttempts?: number;
};

const HOST_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "NODE_PATH",
]);

const DAEMON_ENV_DENY = new Set([
  "LAWMIND_LOCAL_API_TOKEN",
  "LAWMIND_SKIP_API_AUTH",
  "LAWMIND_DESKTOP_PORT",
  // 凭据根密钥与代次：daemon 不监听任何端口，没有任何理由持有它们。
  "LAWMIND_LOCAL_API_INSTALLATION_SECRET",
  "LAWMIND_LOCAL_API_EPOCH",
  "LAWMIND_LOCAL_API_REVOKED_CLIENTS",
  "LAWMIND_LOCAL_API_INSTANCE_ID",
]);

/** Env for lawmindd: LAWMIND_* / host PATH, never the desktop loopback token. */
export function buildDaemonProcessEnv(
  source: NodeJS.ProcessEnv,
  extra?: Record<string, string | undefined>,
  opts: { supervisor?: boolean } = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null || value === "") {
      continue;
    }
    if (DAEMON_ENV_DENY.has(key)) {
      continue;
    }
    if (HOST_ENV_KEYS.has(key) || key.startsWith("LAWMIND_") || key.startsWith("BRAVE_")) {
      out[key] = value;
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value != null && value !== "") {
        out[key] = value;
      }
    }
  }
  out.LAWMIND_DAEMON = "1";
  if (opts.supervisor) {
    // 监督进程自己**不是** tick 进程：真正的 tick 由它 fork 的子进程跑。
    delete out.LAWMIND_DAEMON;
    out.LAWMIND_DAEMON_SUPERVISOR = "1";
  }
  delete out.LAWMIND_LOCAL_API_TOKEN;
  delete out.LAWMIND_SKIP_API_AUTH;
  delete out.LAWMIND_DESKTOP_PORT;
  delete out.LAWMIND_LOCAL_API_INSTALLATION_SECRET;
  delete out.LAWMIND_LOCAL_API_EPOCH;
  delete out.LAWMIND_LOCAL_API_REVOKED_CLIENTS;
  delete out.LAWMIND_LOCAL_API_INSTANCE_ID;
  return out;
}

export function daemonDir(workspaceDir: string): string {
  return path.join(workspaceDir, DAEMON_DIR);
}

export function daemonStatePath(workspaceDir: string): string {
  return path.join(daemonDir(workspaceDir), DAEMON_STATE_FILE);
}

export function daemonPidPath(workspaceDir: string): string {
  return path.join(daemonDir(workspaceDir), DAEMON_PID_FILE);
}

export function daemonLockPath(workspaceDir: string): string {
  return path.join(daemonDir(workspaceDir), DAEMON_LOCK_FILE);
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readDaemonState(workspaceDir: string): LawmindDaemonState {
  try {
    const raw = JSON.parse(
      fs.readFileSync(daemonStatePath(workspaceDir), "utf8"),
    ) as Partial<LawmindDaemonState>;
    return {
      enabled: raw.enabled === true,
      pid: typeof raw.pid === "number" ? raw.pid : undefined,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
      lastTickAt: typeof raw.lastTickAt === "string" ? raw.lastTickAt : undefined,
      heartbeatAt: typeof raw.heartbeatAt === "string" ? raw.heartbeatAt : undefined,
      restartCount: typeof raw.restartCount === "number" ? raw.restartCount : undefined,
      lastExitClass: raw.lastExitClass,
      lastExitAt: typeof raw.lastExitAt === "string" ? raw.lastExitAt : undefined,
      lastExitDetail: typeof raw.lastExitDetail === "string" ? raw.lastExitDetail : undefined,
      supervisionGaveUpAt:
        typeof raw.supervisionGaveUpAt === "string" ? raw.supervisionGaveUpAt : undefined,
      supervisionGaveUpReason:
        typeof raw.supervisionGaveUpReason === "string" ? raw.supervisionGaveUpReason : undefined,
      supervisionGaveUpAttempts:
        typeof raw.supervisionGaveUpAttempts === "number"
          ? raw.supervisionGaveUpAttempts
          : undefined,
    };
  } catch {
    return { enabled: false };
  }
}

export function writeDaemonState(workspaceDir: string, state: LawmindDaemonState): void {
  fs.mkdirSync(daemonDir(workspaceDir), { recursive: true });
  writeJsonAtomic(daemonStatePath(workspaceDir), state);
}

/** 心跳年龄（毫秒）；无记录时 undefined。负值（时钟回拨）按 0 处理。 */
export function heartbeatAgeMs(
  state: Pick<LawmindDaemonState, "heartbeatAt">,
  now: number = Date.now(),
): number | undefined {
  if (!state.heartbeatAt) {
    return undefined;
  }
  const at = Date.parse(state.heartbeatAt);
  if (!Number.isFinite(at)) {
    return undefined;
  }
  return Math.max(0, now - at);
}

/** 心跳是否过期。无记录不算过期（从未起过 ≠ 卡死）。 */
export function isHeartbeatStale(
  state: Pick<LawmindDaemonState, "heartbeatAt">,
  opts: { now?: number; staleMs?: number } = {},
): boolean {
  const age = heartbeatAgeMs(state, opts.now);
  if (age === undefined) {
    return false;
  }
  return age > (opts.staleMs ?? DAEMON_HEARTBEAT_STALE_MS);
}

export function getDaemonStatus(
  workspaceDir: string,
  opts: { now?: number } = {},
): LawmindDaemonStatus {
  const state = readDaemonState(workspaceDir);
  const pidFromFile = readDaemonPid(workspaceDir) ?? state.pid;
  const running = pidFromFile != null && isPidAlive(pidFromFile);
  const age = running ? heartbeatAgeMs(state, opts.now) : undefined;
  return {
    enabled: state.enabled,
    running,
    pid: running ? pidFromFile : undefined,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    heartbeatAt: state.heartbeatAt,
    heartbeatAgeMs: age,
    // 只有「进程活着」时心跳过期才有意义；进程已死由 running=false 表达。
    heartbeatStale: running ? isHeartbeatStale(state, opts) : false,
    restartCount: state.restartCount ?? 0,
    lastExitClass: state.lastExitClass,
    lastExitAt: state.lastExitAt,
    lastExitDetail: state.lastExitDetail,
    supervisionGaveUp: state.supervisionGaveUpAt != null,
    supervisionGaveUpReason: state.supervisionGaveUpReason,
    supervisionGaveUpAttempts: state.supervisionGaveUpAttempts,
  };
}

export function setDaemonEnabled(workspaceDir: string, enabled: boolean): LawmindDaemonStatus {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, { ...prev, enabled });
  return getDaemonStatus(workspaceDir);
}

/**
 * 记一次启动。
 * `restartCount` 由调用方传入，以区分「首次启动」与「监督重启」。
 */
export function markDaemonStarted(
  workspaceDir: string,
  pid: number,
  opts: { restartCount?: number } = {},
): LawmindDaemonStatus {
  const prev = readDaemonState(workspaceDir);
  const startedAt = new Date().toISOString();
  writeDaemonState(workspaceDir, {
    ...prev,
    enabled: true,
    pid,
    startedAt,
    heartbeatAt: startedAt,
    restartCount: opts.restartCount ?? 0,
  });
  fs.mkdirSync(daemonDir(workspaceDir), { recursive: true });
  fs.writeFileSync(daemonPidPath(workspaceDir), `${pid}\n`, "utf8");
  return getDaemonStatus(workspaceDir);
}

/** 每个 tick 刷新心跳。心跳过期 = 循环卡死，与「进程没了」区分开。 */
export function markDaemonHeartbeat(workspaceDir: string, at: Date = new Date()): void {
  const prev = readDaemonState(workspaceDir);
  const iso = at.toISOString();
  writeDaemonState(workspaceDir, { ...prev, heartbeatAt: iso, lastTickAt: iso });
}

export function markDaemonTick(workspaceDir: string): void {
  markDaemonHeartbeat(workspaceDir);
}

/** 记录一次意外退出（供桌面重开时如实回执）。 */
export function markDaemonExit(
  workspaceDir: string,
  exit: { exitClass: DaemonExitClass; detail?: string; at?: Date },
): void {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, {
    ...prev,
    lastExitClass: exit.exitClass,
    lastExitAt: (exit.at ?? new Date()).toISOString(),
    lastExitDetail: exit.detail,
  });
}

/** 监督进程决定放弃重试：这件事必须被写下来，否则会变成「无声地不再办件」。 */
export function markDaemonSupervisionGaveUp(
  workspaceDir: string,
  input: { reason: string; attempts: number; at?: Date },
): void {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, {
    ...prev,
    supervisionGaveUpAt: (input.at ?? new Date()).toISOString(),
    supervisionGaveUpReason: input.reason,
    supervisionGaveUpAttempts: input.attempts,
  });
}

/** 律师显式重新启用时清掉「已放弃」旗标，让后台重新有资格启动。 */
export function clearDaemonSupervisionGiveUp(workspaceDir: string): void {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, {
    ...prev,
    supervisionGaveUpAt: undefined,
    supervisionGaveUpReason: undefined,
    supervisionGaveUpAttempts: undefined,
  });
}

export function clearDaemonPid(workspaceDir: string): void {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, {
    ...prev,
    enabled: prev.enabled,
    pid: undefined,
    // 保留 lastTickAt / heartbeatAt / 退出记录 / 重启计数：
    // 桌面重开时正需要这些来回答「你走后发生了什么」。
  });
  try {
    fs.unlinkSync(daemonPidPath(workspaceDir));
  } catch {
    /* missing is fine */
  }
}

export function stopDaemonProcess(workspaceDir: string): LawmindDaemonStatus {
  const status = getDaemonStatus(workspaceDir);
  if (status.pid && isPidAlive(status.pid) && status.pid !== process.pid) {
    try {
      process.kill(status.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  clearDaemonPid(workspaceDir);
  releaseDaemonLock(workspaceDir);
  return getDaemonStatus(workspaceDir);
}

export type DaemonLockResult =
  | { acquired: true; pid: number }
  | { acquired: false; reason: "held"; heldBy?: number }
  | { acquired: false; reason: "io_error"; detail: string };

/**
 * 抢单实例锁。返回 `acquired: false` 时调用方必须**不启动 tick 循环**。
 * 陈锁（pid 已死）会被接管；活锁不会被抢。
 */
export function acquireDaemonLock(
  workspaceDir: string,
  pid: number = process.pid,
): DaemonLockResult {
  const file = daemonLockPath(workspaceDir);
  const payload = `${JSON.stringify({ pid, at: new Date().toISOString() })}\n`;
  try {
    fs.mkdirSync(daemonDir(workspaceDir), { recursive: true });
  } catch (err) {
    return { acquired: false, reason: "io_error", detail: errorText(err) };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, payload, { encoding: "utf8", flag: "wx" });
      return { acquired: true, pid };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        return { acquired: false, reason: "io_error", detail: errorText(err) };
      }
    }
    const holder = readDaemonLockPid(workspaceDir);
    if (holder != null && holder !== pid && isPidAlive(holder)) {
      return { acquired: false, reason: "held", heldBy: holder };
    }
    // 陈锁或自己的残留：清掉后重试一次。第二次仍 EEXIST 说明有并发抢锁者，让位。
    try {
      fs.unlinkSync(file);
    } catch {
      /* another writer won the unlink race */
    }
  }
  const holder = readDaemonLockPid(workspaceDir);
  return { acquired: false, reason: "held", heldBy: holder };
}

/** 只释放属于自己的锁，避免把别人的锁删掉。 */
export function releaseDaemonLock(workspaceDir: string, pid: number = process.pid): void {
  const holder = readDaemonLockPid(workspaceDir);
  if (holder != null && holder !== pid) {
    return;
  }
  try {
    fs.unlinkSync(daemonLockPath(workspaceDir));
  } catch {
    /* missing is fine */
  }
}

export function readDaemonLockPid(workspaceDir: string): number | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(daemonLockPath(workspaceDir), "utf8")) as {
      pid?: unknown;
    };
    const pid = Number(raw?.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 「你走后发生了什么」的律师侧回执。
 *
 * 契约：**只在真出过事时才有内容**。
 * 处于「未运行」不在此列——桌面开着时正常就是未运行（桌面负责 tick），
 * 引擎无从判断，那是状态徽章该表达的事，不是回执该表达的事。
 */
export function summarizeDaemonForLawyer(
  status: LawmindDaemonStatus,
): { headline: string; details: string[] } | null {
  const details: string[] = [];
  if (status.supervisionGaveUp) {
    const attempts = status.supervisionGaveUpAttempts ?? status.restartCount ?? 0;
    details.push(describeDaemonGiveUpForLawyer(status.supervisionGaveUpReason ?? "", attempts));
  } else if (status.restartCount && status.restartCount > 0) {
    details.push(`期间后台办件中断过 ${status.restartCount} 次，已自动重启。`);
  }
  if (status.lastExitClass && status.lastExitClass !== "stopped") {
    details.push(
      describeDaemonExitForLawyer(status.lastExitClass, {
        code: parseExitCode(status.lastExitDetail),
      }),
    );
  }
  if (status.running && status.heartbeatStale) {
    details.push("后台办件还开着，但已经超过一分钟没有动静，可能卡住了。");
  }
  if (details.length === 0) {
    return null;
  }
  const headline = status.supervisionGaveUp
    ? "后台办件已停止重试"
    : status.heartbeatStale
      ? "后台办件可能卡住了"
      : "后台办件中断过，已自动恢复";
  return { headline, details };
}

function parseExitCode(detail: string | undefined): number | undefined {
  if (!detail) {
    return undefined;
  }
  const match = /(?:exit_code|code)=(-?\d+)/.exec(detail);
  if (!match) {
    return undefined;
  }
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readDaemonPid(workspaceDir: string): number | undefined {
  try {
    const raw = fs.readFileSync(daemonPidPath(workspaceDir), "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

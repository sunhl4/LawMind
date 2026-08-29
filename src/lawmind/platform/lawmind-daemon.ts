/**
 * Local lawmindd — keep automations ticking after the desktop window closes.
 * One workspace, one pid file. Not a cloud VM.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";

export const DAEMON_DIR = "lawmind";
export const DAEMON_STATE_FILE = "daemon.json";
export const DAEMON_PID_FILE = "daemon.pid";

export type LawmindDaemonState = {
  enabled: boolean;
  pid?: number;
  startedAt?: string;
  lastTickAt?: string;
};

export type LawmindDaemonStatus = {
  enabled: boolean;
  running: boolean;
  pid?: number;
  startedAt?: string;
  lastTickAt?: string;
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
]);

/** Env for lawmindd: LAWMIND_* / host PATH, never the desktop loopback token. */
export function buildDaemonProcessEnv(
  source: NodeJS.ProcessEnv,
  extra?: Record<string, string | undefined>,
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
  delete out.LAWMIND_LOCAL_API_TOKEN;
  delete out.LAWMIND_SKIP_API_AUTH;
  delete out.LAWMIND_DESKTOP_PORT;
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
    };
  } catch {
    return { enabled: false };
  }
}

export function writeDaemonState(workspaceDir: string, state: LawmindDaemonState): void {
  fs.mkdirSync(daemonDir(workspaceDir), { recursive: true });
  writeJsonAtomic(daemonStatePath(workspaceDir), state);
}

export function getDaemonStatus(workspaceDir: string): LawmindDaemonStatus {
  const state = readDaemonState(workspaceDir);
  const pidFromFile = readDaemonPid(workspaceDir) ?? state.pid;
  const running = pidFromFile != null && isPidAlive(pidFromFile);
  return {
    enabled: state.enabled,
    running,
    pid: running ? pidFromFile : undefined,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
  };
}

export function setDaemonEnabled(workspaceDir: string, enabled: boolean): LawmindDaemonStatus {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, { ...prev, enabled });
  return getDaemonStatus(workspaceDir);
}

export function markDaemonStarted(workspaceDir: string, pid: number): LawmindDaemonStatus {
  const prev = readDaemonState(workspaceDir);
  const startedAt = new Date().toISOString();
  writeDaemonState(workspaceDir, { ...prev, enabled: true, pid, startedAt });
  fs.mkdirSync(daemonDir(workspaceDir), { recursive: true });
  fs.writeFileSync(daemonPidPath(workspaceDir), `${pid}\n`, "utf8");
  return getDaemonStatus(workspaceDir);
}

export function markDaemonTick(workspaceDir: string): void {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, { ...prev, lastTickAt: new Date().toISOString() });
}

export function clearDaemonPid(workspaceDir: string): void {
  const prev = readDaemonState(workspaceDir);
  writeDaemonState(workspaceDir, {
    enabled: prev.enabled,
    lastTickAt: prev.lastTickAt,
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
  return getDaemonStatus(workspaceDir);
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

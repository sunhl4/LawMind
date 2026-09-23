/**
 * lawmindd 日志文件：桌面关窗后后台进程的唯一可查现场。
 *
 * 设计取舍：
 * - **单世代轮转**（`daemon.log` → `daemon.log.1`），只为把磁盘占用封顶；
 *   不做多世代，因为这份日志的用途是「律师重开桌面时，看得出你走后发生了什么」，
 *   不是长期归档（长期归档走 `audit/`，且 `GOALS.md` 明确不把记录当产品价值）。
 * - 追加写用 `flag: "a"`，POSIX 下小写入是原子的；监督进程与子进程可同时写。
 * - 读侧只提供 tail，因为消费方只需要「最近发生了什么」。
 */

import fs from "node:fs";
import path from "node:path";
import { daemonDir } from "./lawmind-daemon.js";

export const DAEMON_LOG_FILE = "daemon.log";
export const DAEMON_LOG_ROTATED_FILE = "daemon.log.1";

/** 单文件上限（1 MiB）。超过即轮转，避免后台进程无声写爆工作区。 */
export const DAEMON_LOG_MAX_BYTES = 1_048_576;

export type DaemonLogLevel = "info" | "warn" | "error";

export function daemonLogPath(workspaceDir: string): string {
  return path.join(daemonDir(workspaceDir), DAEMON_LOG_FILE);
}

export function daemonRotatedLogPath(workspaceDir: string): string {
  return path.join(daemonDir(workspaceDir), DAEMON_LOG_ROTATED_FILE);
}

/**
 * 一行日志的稳定格式。时间戳走 ISO，便于与 `daemon.json` 的 `heartbeatAt`
 * 直接对照（律师/工程两侧不需要换算时区）。
 */
export function formatDaemonLogLine(
  level: DaemonLogLevel,
  message: string,
  at: Date = new Date(),
): string {
  const flat = message.replace(/\r?\n/g, " ⏎ ").trim();
  return `${at.toISOString()} [${level}] ${flat}\n`;
}

/**
 * 需要轮转吗。`size` 可注入，便于单测不写 1 MiB 文件。
 */
export function shouldRotateDaemonLog(
  size: number,
  maxBytes: number = DAEMON_LOG_MAX_BYTES,
): boolean {
  return Number.isFinite(size) && size >= maxBytes;
}

/**
 * 超限则轮转。返回是否发生了轮转。
 * 任何失败都吞掉：日志不是交付路径，不能因为写日志把后台进程打挂。
 */
export function rotateDaemonLogIfNeeded(
  workspaceDir: string,
  maxBytes: number = DAEMON_LOG_MAX_BYTES,
): boolean {
  const live = daemonLogPath(workspaceDir);
  try {
    const stat = fs.statSync(live);
    if (!shouldRotateDaemonLog(stat.size, maxBytes)) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    fs.renameSync(live, daemonRotatedLogPath(workspaceDir));
    return true;
  } catch {
    return false;
  }
}

/** 追加一行。失败静默（后台日志永不阻断办件）。 */
export function appendDaemonLogLine(
  workspaceDir: string,
  level: DaemonLogLevel,
  message: string,
  opts: { at?: Date; maxBytes?: number } = {},
): void {
  try {
    fs.mkdirSync(daemonDir(workspaceDir), { recursive: true });
    rotateDaemonLogIfNeeded(workspaceDir, opts.maxBytes);
    fs.appendFileSync(
      daemonLogPath(workspaceDir),
      formatDaemonLogLine(level, message, opts.at),
      "utf8",
    );
  } catch {
    /* best-effort */
  }
}

/**
 * 读最近 maxLines 行，按时间正序返回。文件不存在/不可读时返回空数组——
 * 调用方据此区分「还没跑过」与「跑过但无事发生」。
 */
export function readDaemonLogTail(
  workspaceDir: string,
  maxLines = 200,
  opts: { includeRotated?: boolean } = {},
): string[] {
  const limit = Math.max(0, Math.floor(maxLines) || 0);
  if (limit === 0) {
    return [];
  }
  const readAll = (file: string): string[] => {
    try {
      return fs.readFileSync(file, "utf8").split("\n");
    } catch {
      return [];
    }
  };
  const rotated = opts.includeRotated ? readAll(daemonRotatedLogPath(workspaceDir)) : [];
  const lines = [...rotated, ...readAll(daemonLogPath(workspaceDir))].filter(
    (line) => line.trim() !== "",
  );
  return lines.slice(-limit);
}

/** 日志文件是否存在（含轮转后的旧世代）。 */
export function daemonLogExists(workspaceDir: string): boolean {
  try {
    fs.statSync(daemonLogPath(workspaceDir));
    return true;
  } catch {
    try {
      fs.statSync(daemonRotatedLogPath(workspaceDir));
      return true;
    } catch {
      return false;
    }
  }
}

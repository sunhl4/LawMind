import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAEMON_LOG_MAX_BYTES,
  appendDaemonLogLine,
  daemonLogExists,
  daemonLogPath,
  daemonRotatedLogPath,
  formatDaemonLogLine,
  readDaemonLogTail,
  rotateDaemonLogIfNeeded,
  shouldRotateDaemonLog,
} from "./lawmind-daemon-log.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-daemon-log-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("formatDaemonLogLine", () => {
  it("writes an ISO timestamp, the level, and the message", () => {
    const line = formatDaemonLogLine(
      "info",
      "[lawmindd] started",
      new Date("2026-09-21T06:00:00.000Z"),
    );
    expect(line).toBe("2026-09-21T06:00:00.000Z [info] [lawmindd] started\n");
  });

  it("flattens newlines so one event stays one line", () => {
    const line = formatDaemonLogLine(
      "error",
      "boom\nstack line 2",
      new Date("2026-09-21T06:00:00.000Z"),
    );
    expect(line.split("\n")).toHaveLength(2);
    expect(line).toContain("⏎");
  });
});

describe("shouldRotateDaemonLog", () => {
  it("rotates at the cap and not before", () => {
    expect(shouldRotateDaemonLog(0)).toBe(false);
    expect(shouldRotateDaemonLog(DAEMON_LOG_MAX_BYTES - 1)).toBe(false);
    expect(shouldRotateDaemonLog(DAEMON_LOG_MAX_BYTES)).toBe(true);
    expect(shouldRotateDaemonLog(DAEMON_LOG_MAX_BYTES + 1)).toBe(true);
  });

  it("ignores non-finite sizes rather than rotating on garbage", () => {
    expect(shouldRotateDaemonLog(Number.NaN)).toBe(false);
    expect(shouldRotateDaemonLog(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("honours an injected cap", () => {
    expect(shouldRotateDaemonLog(10, 10)).toBe(true);
    expect(shouldRotateDaemonLog(9, 10)).toBe(false);
  });
});

describe("appendDaemonLogLine / readDaemonLogTail", () => {
  it("creates the log directory on demand and appends in order", () => {
    const ws = tmpWs();
    expect(daemonLogExists(ws)).toBe(false);
    appendDaemonLogLine(ws, "info", "first");
    appendDaemonLogLine(ws, "error", "second");
    expect(daemonLogExists(ws)).toBe(true);
    const tail = readDaemonLogTail(ws);
    expect(tail).toHaveLength(2);
    expect(tail[0]).toContain("first");
    expect(tail[1]).toContain("[error] second");
  });

  it("returns the newest lines when limited", () => {
    const ws = tmpWs();
    for (let i = 1; i <= 10; i += 1) {
      appendDaemonLogLine(ws, "info", `line-${i}`);
    }
    const tail = readDaemonLogTail(ws, 3);
    expect(tail).toHaveLength(3);
    expect(tail.map((l) => /line-\d+$/.exec(l)?.[0])).toEqual(["line-8", "line-9", "line-10"]);
  });

  it("returns an empty list for a workspace that never ran (not a fake success)", () => {
    expect(readDaemonLogTail(tmpWs())).toEqual([]);
  });

  it("returns an empty list when the caller asks for zero lines", () => {
    const ws = tmpWs();
    appendDaemonLogLine(ws, "info", "something");
    expect(readDaemonLogTail(ws, 0)).toEqual([]);
  });

  it("survives a log path that is a directory (never throws into the tick loop)", () => {
    const ws = tmpWs();
    fs.mkdirSync(daemonLogPath(ws), { recursive: true });
    expect(() => appendDaemonLogLine(ws, "info", "still fine")).not.toThrow();
  });
});

describe("rotation", () => {
  it("moves the live file aside once it exceeds the cap and keeps one generation", () => {
    const ws = tmpWs();
    appendDaemonLogLine(ws, "info", "oldest", { maxBytes: 64 });
    expect(rotateDaemonLogIfNeeded(ws, 1)).toBe(true);
    expect(fs.existsSync(daemonRotatedLogPath(ws))).toBe(true);
    expect(fs.existsSync(daemonLogPath(ws))).toBe(false);

    appendDaemonLogLine(ws, "info", "newest", { maxBytes: 64 });
    expect(readDaemonLogTail(ws)).toHaveLength(1);
    expect(readDaemonLogTail(ws)[0]).toContain("newest");
  });

  it("reports no rotation when the file is under the cap", () => {
    const ws = tmpWs();
    appendDaemonLogLine(ws, "info", "small");
    expect(rotateDaemonLogIfNeeded(ws, DAEMON_LOG_MAX_BYTES)).toBe(false);
  });

  it("reports no rotation when there is no log yet", () => {
    expect(rotateDaemonLogIfNeeded(tmpWs(), 1)).toBe(false);
  });

  it("can include the rotated generation when reading a tail", () => {
    const ws = tmpWs();
    appendDaemonLogLine(ws, "info", "generation-one");
    rotateDaemonLogIfNeeded(ws, 1);
    appendDaemonLogLine(ws, "info", "generation-two");
    expect(readDaemonLogTail(ws, 10)).toHaveLength(1);
    expect(readDaemonLogTail(ws, 10, { includeRotated: true })).toHaveLength(2);
  });

  it("caps disk use: rotation overwrites the previous rotated generation", () => {
    const ws = tmpWs();
    appendDaemonLogLine(ws, "info", "first-era");
    rotateDaemonLogIfNeeded(ws, 1);
    appendDaemonLogLine(ws, "info", "second-era");
    rotateDaemonLogIfNeeded(ws, 1);
    appendDaemonLogLine(ws, "info", "third-era");
    const withRotated = readDaemonLogTail(ws, 50, { includeRotated: true });
    expect(withRotated).toHaveLength(2);
    expect(withRotated.some((l) => l.includes("first-era"))).toBe(false);
  });
});

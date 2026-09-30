import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAEMON_HEARTBEAT_STALE_MS,
  DAEMON_TICK_INTERVAL_MS,
  acquireDaemonLock,
  buildDaemonProcessEnv,
  clearDaemonPid,
  clearDaemonSupervisionGiveUp,
  daemonLockPath,
  getDaemonStatus,
  heartbeatAgeMs,
  isHeartbeatStale,
  isPidAlive,
  markDaemonExit,
  markDaemonHeartbeat,
  markDaemonStarted,
  markDaemonSupervisionGaveUp,
  readDaemonLockPid,
  readDaemonState,
  releaseDaemonLock,
  setDaemonEnabled,
  stopDaemonProcess,
  shouldNotifyDaemonIncident,
  summarizeDaemonForLawyer,
} from "./lawmind-daemon.js";

const dirs: string[] = [];

/** 一个几乎不可能在跑、且 process.kill 不会误判为活着的 pid。 */
const DEAD_PID = 999_999;

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-daemon-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("lawmind-daemon state", () => {
  it("defaults to disabled and not running", () => {
    const ws = tmpWs();
    expect(getDaemonStatus(ws)).toMatchObject({ enabled: false, running: false });
  });

  it("persists enabled and records a live pid", () => {
    const ws = tmpWs();
    setDaemonEnabled(ws, true);
    expect(readDaemonState(ws).enabled).toBe(true);
    markDaemonStarted(ws, process.pid);
    const status = getDaemonStatus(ws);
    expect(status.enabled).toBe(true);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("buildDaemonProcessEnv drops loopback token and unrelated secrets", () => {
    const env = buildDaemonProcessEnv(
      {
        PATH: "/bin",
        HOME: "/Users/x",
        LAWMIND_WORKSPACE_DIR: "/ws",
        LAWMIND_LOCAL_API_TOKEN: "secret-token",
        LAWMIND_SKIP_API_AUTH: "1",
        LAWMIND_DESKTOP_PORT: "50528",
        LAWMIND_AGENT_API_KEY: "sk-keep",
        AWS_SECRET_ACCESS_KEY: "aws-no",
        SHELL: "/bin/zsh",
      },
      { LAWMIND_REPO_ROOT: "/repo" },
    );
    expect(env.LAWMIND_DAEMON).toBe("1");
    expect(env.LAWMIND_WORKSPACE_DIR).toBe("/ws");
    expect(env.LAWMIND_AGENT_API_KEY).toBe("sk-keep");
    expect(env.LAWMIND_REPO_ROOT).toBe("/repo");
    expect(env.PATH).toBe("/bin");
    expect(env.LAWMIND_LOCAL_API_TOKEN).toBeUndefined();
    expect(env.LAWMIND_SKIP_API_AUTH).toBeUndefined();
    expect(env.LAWMIND_DESKTOP_PORT).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.SHELL).toBeUndefined();
  });

  it("stopDaemonProcess does not kill the current test process", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid);
    const after = stopDaemonProcess(ws);
    expect(after.running).toBe(false);
    expect(isPidAlive(process.pid)).toBe(true);
  });
});

describe("daemon heartbeat", () => {
  it("treats a missing heartbeat as 'never started', not as stale", () => {
    const ws = tmpWs();
    expect(heartbeatAgeMs({})).toBeUndefined();
    expect(isHeartbeatStale({})).toBe(false);
    expect(getDaemonStatus(ws).heartbeatStale).toBe(false);
  });

  it("records the heartbeat on start and refreshes it on each tick", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid);
    expect(readDaemonState(ws).heartbeatAt).toBeTruthy();

    const at = new Date("2026-09-21T06:00:00.000Z");
    markDaemonHeartbeat(ws, at);
    const state = readDaemonState(ws);
    expect(state.heartbeatAt).toBe("2026-09-21T06:00:00.000Z");
    expect(state.lastTickAt).toBe("2026-09-21T06:00:00.000Z");
  });

  it("computes age from the recorded heartbeat", () => {
    const state = { heartbeatAt: "2026-09-21T06:00:00.000Z" };
    const now = Date.parse("2026-09-21T06:00:30.000Z");
    expect(heartbeatAgeMs(state, now)).toBe(30_000);
  });

  it("clamps a backwards clock to zero instead of reporting a negative age", () => {
    const state = { heartbeatAt: "2026-09-21T06:00:10.000Z" };
    const now = Date.parse("2026-09-21T06:00:00.000Z");
    expect(heartbeatAgeMs(state, now)).toBe(0);
  });

  it("ignores an unparseable heartbeat instead of claiming staleness", () => {
    expect(heartbeatAgeMs({ heartbeatAt: "not-a-date" })).toBeUndefined();
    expect(isHeartbeatStale({ heartbeatAt: "not-a-date" })).toBe(false);
  });

  it("goes stale only past the tolerance window", () => {
    const at = "2026-09-21T06:00:00.000Z";
    const base = Date.parse(at);
    expect(isHeartbeatStale({ heartbeatAt: at }, { now: base + DAEMON_HEARTBEAT_STALE_MS })).toBe(
      false,
    );
    expect(
      isHeartbeatStale({ heartbeatAt: at }, { now: base + DAEMON_HEARTBEAT_STALE_MS + 1 }),
    ).toBe(true);
  });

  it("tolerates at least one slow tick so a heavy run is not reported as a hang", () => {
    expect(DAEMON_HEARTBEAT_STALE_MS).toBeGreaterThan(DAEMON_TICK_INTERVAL_MS * 2);
  });

  it("only reports staleness while the process is actually alive", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, DEAD_PID);
    markDaemonHeartbeat(ws, new Date(Date.now() - DAEMON_HEARTBEAT_STALE_MS * 10));
    const status = getDaemonStatus(ws);
    expect(status.running).toBe(false);
    // 进程已死由 running=false 表达，不要把死进程报成「卡住」。
    expect(status.heartbeatStale).toBe(false);
  });
});

describe("daemon exit + supervision accounting", () => {
  it("keeps the exit record when the pid is cleared, so the desktop can report it later", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid);
    markDaemonExit(ws, { exitClass: "crashed", detail: "exit_code=1" });
    markDaemonExit(ws, { exitClass: "killed", detail: "signal=SIGKILL" });
    clearDaemonPid(ws);

    const status = getDaemonStatus(ws);
    expect(status.lastExitClass).toBe("killed");
    expect(status.lastExitDetail).toBe("signal=SIGKILL");
    expect(status.lastExitAt).toBeTruthy();
    // 心跳现场也留着——这正是「你走后发生了什么」需要的东西。
    expect(status.heartbeatAt).toBeTruthy();
  });

  it("surfaces restart count and a give-up flag", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid, { restartCount: 3 });
    expect(getDaemonStatus(ws).restartCount).toBe(3);
    expect(getDaemonStatus(ws).supervisionGaveUp).toBe(false);

    markDaemonSupervisionGaveUp(ws, { reason: "restart_limit_reached:5", attempts: 5 });
    const status = getDaemonStatus(ws);
    expect(status.supervisionGaveUp).toBe(true);
    expect(status.supervisionGaveUpReason).toBe("restart_limit_reached:5");
  });

  it("lets an explicit re-enable clear the give-up flag", () => {
    const ws = tmpWs();
    markDaemonSupervisionGaveUp(ws, { reason: "restart_limit_reached:5", attempts: 5 });
    clearDaemonSupervisionGiveUp(ws);
    expect(getDaemonStatus(ws).supervisionGaveUp).toBe(false);
    expect(readDaemonState(ws).supervisionGaveUpReason).toBeUndefined();
  });

  it("defaults restartCount to zero for a state file written by an older build", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, "lawmind"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "daemon.json"),
      JSON.stringify({ enabled: true, lastTickAt: "2026-09-01T00:00:00.000Z" }),
      "utf8",
    );
    const status = getDaemonStatus(ws);
    expect(status.restartCount).toBe(0);
    expect(status.supervisionGaveUp).toBe(false);
    expect(status.heartbeatAt).toBeUndefined();
  });
});

describe("daemon single-instance lock", () => {
  it("grants the lock to the first caller and writes its pid", () => {
    const ws = tmpWs();
    const result = acquireDaemonLock(ws, process.pid);
    expect(result).toEqual({ acquired: true, pid: process.pid });
    expect(readDaemonLockPid(ws)).toBe(process.pid);
  });

  it("refuses the lock while a live process holds it", () => {
    const ws = tmpWs();
    acquireDaemonLock(ws, process.pid);
    const second = acquireDaemonLock(ws, DEAD_PID);
    expect(second.acquired).toBe(false);
    expect(!second.acquired && second.reason).toBe("held");
    expect(!second.acquired && second.reason === "held" && second.heldBy).toBe(process.pid);
  });

  it("takes over a stale lock left by a dead process", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, "lawmind"), { recursive: true });
    fs.writeFileSync(
      daemonLockPath(ws),
      JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00.000Z" }),
      "utf8",
    );
    const result = acquireDaemonLock(ws, process.pid);
    expect(result.acquired).toBe(true);
    expect(readDaemonLockPid(ws)).toBe(process.pid);
  });

  it("takes over a corrupt lock file rather than wedging forever", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, "lawmind"), { recursive: true });
    fs.writeFileSync(daemonLockPath(ws), "not json", "utf8");
    expect(acquireDaemonLock(ws, process.pid).acquired).toBe(true);
  });

  it("re-acquires its own lock (restart in place)", () => {
    const ws = tmpWs();
    acquireDaemonLock(ws, process.pid);
    expect(acquireDaemonLock(ws, process.pid).acquired).toBe(true);
  });

  it("only releases a lock it owns", () => {
    const ws = tmpWs();
    acquireDaemonLock(ws, process.pid);
    releaseDaemonLock(ws, DEAD_PID);
    expect(readDaemonLockPid(ws)).toBe(process.pid);

    releaseDaemonLock(ws, process.pid);
    expect(readDaemonLockPid(ws)).toBeUndefined();
  });

  it("releases the lock when the daemon is stopped", () => {
    const ws = tmpWs();
    acquireDaemonLock(ws, process.pid);
    stopDaemonProcess(ws);
    expect(readDaemonLockPid(ws)).toBeUndefined();
  });

  it("reports a missing lock as undefined instead of throwing", () => {
    expect(readDaemonLockPid(tmpWs())).toBeUndefined();
  });
});

describe("summarizeDaemonForLawyer", () => {
  it("stays silent when nothing happened (quiet success is still success)", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid);
    expect(summarizeDaemonForLawyer(getDaemonStatus(ws))).toBeNull();
  });

  it("reports auto-recovery after a crash", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid, { restartCount: 2 });
    markDaemonExit(ws, { exitClass: "crashed", detail: "exit_code=1" });
    const summary = summarizeDaemonForLawyer(getDaemonStatus(ws));
    expect(summary).not.toBeNull();
    expect(summary?.headline).toContain("已自动恢复");
    expect(summary?.details.join(" ")).toContain("中断过 2 次");
  });

  it("leads with the give-up banner when retries are exhausted", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid, { restartCount: 5 });
    markDaemonSupervisionGaveUp(ws, { reason: "restart_limit_reached:5", attempts: 5 });
    const summary = summarizeDaemonForLawyer(getDaemonStatus(ws));
    expect(summary?.headline).toContain("已停止重试");
    expect(summary?.details.join(" ")).toContain("没有运行");
  });

  it("flags a live but stalled daemon", () => {
    const ws = tmpWs();
    markDaemonStarted(ws, process.pid);
    markDaemonHeartbeat(ws, new Date(Date.now() - DAEMON_HEARTBEAT_STALE_MS * 4));
    const summary = summarizeDaemonForLawyer(getDaemonStatus(ws));
    expect(summary?.headline).toContain("卡住");
  });

  it("does not mention a normal stop as a problem", () => {
    const ws = tmpWs();
    setDaemonEnabled(ws, true);
    markDaemonExit(ws, { exitClass: "stopped" });
    expect(summarizeDaemonForLawyer(getDaemonStatus(ws))).toBeNull();
  });
});

describe("shouldNotifyDaemonIncident", () => {
  it("notifies on give-up and heartbeat stale, not on quiet auto-recovery alone", () => {
    expect(shouldNotifyDaemonIncident({ supervisionGaveUp: true, heartbeatStale: false })).toBe(
      true,
    );
    expect(shouldNotifyDaemonIncident({ supervisionGaveUp: false, heartbeatStale: true })).toBe(
      true,
    );
    expect(shouldNotifyDaemonIncident({ supervisionGaveUp: false, heartbeatStale: false })).toBe(
      false,
    );
  });
});

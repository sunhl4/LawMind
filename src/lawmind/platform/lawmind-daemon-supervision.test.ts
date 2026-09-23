import { describe, expect, it } from "vitest";
import {
  DAEMON_SUPERVISION_DEFAULTS,
  classifyDaemonExit,
  computeDaemonRestartDelayMs,
  decideDaemonSupervision,
  describeDaemonExitForLawyer,
  describeDaemonGiveUpForLawyer,
  shouldRestartDaemon,
} from "./lawmind-daemon-supervision.js";

describe("classifyDaemonExit", () => {
  it("treats an intentional stop as stopped, whatever the code says", () => {
    expect(classifyDaemonExit({ intentional: true, code: 1 })).toBe("stopped");
    expect(classifyDaemonExit({ intentional: true, signal: "SIGKILL" })).toBe("stopped");
  });

  it("treats SIGTERM / SIGINT as normal stops (that is what stopDaemonProcess sends)", () => {
    expect(classifyDaemonExit({ signal: "SIGTERM" })).toBe("stopped");
    expect(classifyDaemonExit({ signal: "SIGINT" })).toBe("stopped");
  });

  it("treats other death signals as killed", () => {
    expect(classifyDaemonExit({ signal: "SIGKILL" })).toBe("killed");
    expect(classifyDaemonExit({ signal: "SIGSEGV" })).toBe("killed");
    expect(classifyDaemonExit({ signal: "SIGABRT" })).toBe("killed");
  });

  it("treats a zero exit code as clean (the child decided to stop)", () => {
    expect(classifyDaemonExit({ code: 0 })).toBe("clean");
    expect(classifyDaemonExit({ code: 0, signal: null })).toBe("clean");
  });

  it("treats a non-zero code as crashed", () => {
    expect(classifyDaemonExit({ code: 1 })).toBe("crashed");
    expect(classifyDaemonExit({ code: 137 })).toBe("crashed");
  });

  it("treats a bare exit with no code and no signal as crashed rather than clean", () => {
    expect(classifyDaemonExit({})).toBe("crashed");
    expect(classifyDaemonExit({ code: null, signal: null })).toBe("crashed");
  });
});

describe("daemon supervision backoff", () => {
  it("is deterministic and exponential up to the cap", () => {
    expect(computeDaemonRestartDelayMs(1)).toBe(DAEMON_SUPERVISION_DEFAULTS.baseDelayMs);
    expect(computeDaemonRestartDelayMs(2)).toBe(DAEMON_SUPERVISION_DEFAULTS.baseDelayMs * 2);
    expect(computeDaemonRestartDelayMs(3)).toBe(DAEMON_SUPERVISION_DEFAULTS.baseDelayMs * 4);
    expect(computeDaemonRestartDelayMs(99)).toBe(DAEMON_SUPERVISION_DEFAULTS.maxDelayMs);
  });

  it("treats garbage attempt numbers as the first attempt", () => {
    expect(computeDaemonRestartDelayMs(0)).toBe(DAEMON_SUPERVISION_DEFAULTS.baseDelayMs);
    expect(computeDaemonRestartDelayMs(-3)).toBe(DAEMON_SUPERVISION_DEFAULTS.baseDelayMs);
    expect(computeDaemonRestartDelayMs(Number.NaN)).toBe(DAEMON_SUPERVISION_DEFAULTS.baseDelayMs);
  });

  it("stops allowing restarts past maxAttempts", () => {
    const { maxAttempts } = DAEMON_SUPERVISION_DEFAULTS;
    expect(shouldRestartDaemon(maxAttempts)).toBe(true);
    expect(shouldRestartDaemon(maxAttempts + 1)).toBe(false);
  });

  it("honours an injected options object", () => {
    expect(computeDaemonRestartDelayMs(3, { baseDelayMs: 100, factor: 2, maxDelayMs: 500 })).toBe(
      400,
    );
    expect(computeDaemonRestartDelayMs(9, { baseDelayMs: 100, factor: 2, maxDelayMs: 500 })).toBe(
      500,
    );
    expect(shouldRestartDaemon(2, { maxAttempts: 1 })).toBe(false);
  });
});

describe("decideDaemonSupervision", () => {
  it("never restarts after a normal stop", () => {
    expect(decideDaemonSupervision({ exitClass: "stopped", attempt: 1 })).toEqual({
      action: "none",
      reason: "intentional_stop",
    });
  });

  it("never restarts after a clean exit", () => {
    expect(decideDaemonSupervision({ exitClass: "clean", attempt: 1 })).toEqual({
      action: "none",
      reason: "clean_exit",
    });
  });

  it("restarts a crash with the backoff for that attempt", () => {
    expect(decideDaemonSupervision({ exitClass: "crashed", attempt: 2 })).toEqual({
      action: "restart",
      attempt: 2,
      delayMs: DAEMON_SUPERVISION_DEFAULTS.baseDelayMs * 2,
      reason: "crashed",
    });
  });

  it("labels a signal death distinctly from a crash", () => {
    const decision = decideDaemonSupervision({ exitClass: "killed", attempt: 1 });
    expect(decision.action).toBe("restart");
    expect(decision.action === "restart" && decision.reason).toBe("killed_by_signal");
  });

  it("gives up once the restart budget is spent, and says so", () => {
    const attempt = DAEMON_SUPERVISION_DEFAULTS.maxAttempts + 1;
    const decision = decideDaemonSupervision({ exitClass: "crashed", attempt });
    expect(decision.action).toBe("give_up");
    expect(decision.action === "give_up" && decision.reason).toContain("restart_limit_reached");
  });

  it("spends exactly maxAttempts restarts before giving up", () => {
    const { maxAttempts } = DAEMON_SUPERVISION_DEFAULTS;
    const actions = Array.from(
      { length: maxAttempts + 1 },
      (_, i) => decideDaemonSupervision({ exitClass: "crashed", attempt: i + 1 }).action,
    );
    expect(actions.filter((a) => a === "restart")).toHaveLength(maxAttempts);
    expect(actions[actions.length - 1]).toBe("give_up");
  });
});

describe("lawyer-facing daemon copy", () => {
  it("says it restarted for both crash and signal death", () => {
    expect(describeDaemonExitForLawyer("killed")).toContain("已自动重启");
    expect(describeDaemonExitForLawyer("crashed", { code: 1 })).toContain("已自动重启");
    expect(describeDaemonExitForLawyer("crashed", { code: 1 })).toContain("1");
  });

  it("does not leak signal names or pids into lawyer copy", () => {
    const killed = describeDaemonExitForLawyer("killed", { signal: "SIGKILL" });
    expect(killed).not.toContain("SIG");
    const crashed = describeDaemonExitForLawyer("crashed", { code: 137 });
    expect(crashed).not.toMatch(/\bpid\b/);
  });

  it("distinguishes a healthy stop from a failure", () => {
    expect(describeDaemonExitForLawyer("stopped")).toContain("正常停止");
  });

  it("tells the lawyer that unattended work did not run after giving up", () => {
    const text = describeDaemonGiveUpForLawyer("restart_limit_reached:5", 5);
    expect(text).toContain("5");
    expect(text).toContain("没有运行");
  });
});

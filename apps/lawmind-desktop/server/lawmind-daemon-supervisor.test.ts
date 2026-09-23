import { describe, expect, it, vi } from "vitest";
import {
  type DaemonChildExit,
  buildSupervisorChildEnv,
  describeDaemonChildExitForLog,
  runDaemonSupervisorLoop,
} from "./lawmind-daemon-supervisor.js";

type ExitStep = DaemonChildExit;

/**
 * 把一段脚本化的退出序列装成 hooks，并记下 spawn / delay 的调用情况。
 * 序列用尽后重复最后一个，模拟「一直以同一方式失败」。
 */
function scriptedHooks(script: ExitStep[], opts: { stopAfter?: number } = {}) {
  const delays: number[] = [];
  const exits: Array<{ exitClass: string; code: number | null; signal: string | null }> = [];
  const giveUps: Array<{ reason: string; attempts: number }> = [];
  const restartsScheduled: Array<{ attempt: number; delayMs: number }> = [];
  let spawns = 0;
  let stopping = false;
  const spawnRestartCounts: number[] = [];

  const hooks = {
    spawnChild: (info: { restartCount: number }) => {
      spawnRestartCounts.push(info.restartCount);
      const index = Math.min(spawns, script.length - 1);
      spawns += 1;
      if (opts.stopAfter != null && spawns >= opts.stopAfter) {
        stopping = true;
      }
      return {
        waitForExit: async () => {
          if (stopping) {
            return { code: null, signal: "SIGTERM" };
          }
          return script[index];
        },
      };
    },
    delay: async (ms: number) => {
      delays.push(ms);
    },
    onChildExit: (info: { exitClass: string; code: number | null; signal: string | null }) => {
      exits.push({ exitClass: info.exitClass, code: info.code, signal: info.signal });
    },
    onGiveUp: (info: { reason: string; attempts: number }) => {
      giveUps.push(info);
    },
    onRestartScheduled: (info: { attempt: number; delayMs: number }) => {
      restartsScheduled.push({ attempt: info.attempt, delayMs: info.delayMs });
    },
  };

  return {
    hooks,
    delays,
    exits,
    giveUps,
    restartsScheduled,
    spawnRestartCounts,
    get spawns() {
      return spawns;
    },
    stop: () => {
      stopping = true;
    },
    isStopping: () => stopping,
  };
}

describe("runDaemonSupervisorLoop", () => {
  it("restarts a crashed child and stops when it later exits cleanly", async () => {
    const h = scriptedHooks([
      { code: 1, signal: null },
      { code: 0, signal: null },
    ]);
    const outcome = await runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping });

    expect(outcome.restarts).toBe(1);
    expect(outcome.gaveUp).toBe(false);
    expect(outcome.reason).toBe("clean_exit");
    expect(h.spawns).toBe(2);
    expect(h.exits.map((e) => e.exitClass)).toEqual(["crashed", "clean"]);
  });

  it("does not restart a child that exits cleanly on the first run", async () => {
    const h = scriptedHooks([{ code: 0, signal: null }]);
    const outcome = await runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping });
    expect(outcome.restarts).toBe(0);
    expect(h.spawns).toBe(1);
    expect(h.delays).toEqual([]);
  });

  it("restarts a child killed by a signal (it never got to say anything)", async () => {
    const h = scriptedHooks([
      { code: null, signal: "SIGKILL" },
      { code: 0, signal: null },
    ]);
    const outcome = await runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping });
    expect(outcome.restarts).toBe(1);
    expect(h.exits[0]?.exitClass).toBe("killed");
  });

  it("stops the moment the caller asks it to, without restarting", async () => {
    const h = scriptedHooks([{ code: null, signal: "SIGKILL" }], { stopAfter: 1 });
    const outcome = await runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping });
    expect(outcome.restarts).toBe(0);
    expect(outcome.reason).toBe("intentional_stop");
    expect(outcome.gaveUp).toBe(false);
    expect(h.spawns).toBe(1);
  });

  it("does not restart when the child dies and the caller already asked to stop", async () => {
    const h = scriptedHooks([{ code: 1, signal: null }]);
    h.stop();
    const outcome = await runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping });
    expect(outcome.reason).toBe("intentional_stop");
    expect(h.spawns).toBe(1);
    expect(outcome.lastExitClass).toBe("stopped");
  });

  it("spends the whole restart budget then gives up and says so", async () => {
    const h = scriptedHooks([{ code: 1, signal: null }]);
    const outcome = await runDaemonSupervisorLoop(h.hooks, {
      isStopping: h.isStopping,
      supervision: { maxAttempts: 5 },
    });

    expect(outcome.gaveUp).toBe(true);
    expect(outcome.restarts).toBe(5);
    expect(h.spawns).toBe(6);
    expect(h.giveUps).toEqual([{ reason: "restart_limit_reached:5", attempts: 5 }]);
    expect(outcome.reason).toContain("restart_limit_reached");
  });

  it("backs off exponentially and deterministically between restarts", async () => {
    const h = scriptedHooks([{ code: 1, signal: null }]);
    await runDaemonSupervisorLoop(h.hooks, {
      isStopping: h.isStopping,
      supervision: { baseDelayMs: 100, factor: 2, maxDelayMs: 1000, maxAttempts: 5 },
    });
    expect(h.delays).toEqual([100, 200, 400, 800, 1000]);
    expect(h.restartsScheduled.map((r) => r.attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it("respects a smaller budget", async () => {
    const h = scriptedHooks([{ code: 1, signal: null }]);
    const outcome = await runDaemonSupervisorLoop(h.hooks, {
      isStopping: h.isStopping,
      supervision: { maxAttempts: 1 },
    });
    expect(outcome.restarts).toBe(1);
    expect(outcome.gaveUp).toBe(true);
    expect(h.spawns).toBe(2);
  });

  it("reports the restarts count that was already spent to onChildExit", async () => {
    const h = scriptedHooks([
      { code: 1, signal: null },
      { code: 1, signal: null },
      { code: 0, signal: null },
    ]);
    await runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping });
    expect(h.exits).toHaveLength(3);
    expect(h.exits.map((e) => e.exitClass)).toEqual(["crashed", "crashed", "clean"]);
  });

  it("never throws out of the loop when the child just keeps dying", async () => {
    const h = scriptedHooks([{ code: null, signal: "SIGABRT" }]);
    await expect(
      runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping, supervision: { maxAttempts: 2 } }),
    ).resolves.toMatchObject({ gaveUp: true, restarts: 2 });
  });
});

describe("describeDaemonChildExitForLog", () => {
  it("prefers the signal when there is one", () => {
    expect(describeDaemonChildExitForLog({ code: null, signal: "SIGKILL" })).toBe("signal=SIGKILL");
  });

  it("falls back to the exit code", () => {
    expect(describeDaemonChildExitForLog({ code: 1, signal: null })).toBe("exit_code=1");
  });

  it("says unknown rather than printing null", () => {
    expect(describeDaemonChildExitForLog({ code: null, signal: null })).toBe("exit_code=unknown");
  });
});

describe("buildSupervisorChildEnv", () => {
  const NOISY_SOURCE: NodeJS.ProcessEnv = {
    PATH: "/bin",
    HOME: "/Users/x",
    LAWMIND_WORKSPACE_DIR: "/ws",
    LAWMIND_ENV_FILE: "/ws/.env.lawmind",
    LAWMIND_AGENT_API_KEY: "sk-keep",
    BRAVE_API_KEY: "brave-keep",
    // 这些都不该进 tick 子进程：它不监听任何端口。
    LAWMIND_LOCAL_API_TOKEN: "loopback-token",
    LAWMIND_SKIP_API_AUTH: "1",
    LAWMIND_DESKTOP_PORT: "50528",
    LAWMIND_LOCAL_API_INSTALLATION_SECRET: "root-secret",
    LAWMIND_LOCAL_API_EPOCH: "7",
    LAWMIND_LOCAL_API_REVOKED_CLIENTS: "a,b",
    LAWMIND_LOCAL_API_INSTANCE_ID: "inst-1",
    AWS_SECRET_ACCESS_KEY: "aws-no",
    SHELL: "/bin/zsh",
  };

  it("marks the child as the tick process, not the supervisor", () => {
    const env = buildSupervisorChildEnv({ LAWMIND_DAEMON_SUPERVISOR: "1" }, { workspaceDir: "/ws" });
    expect(env.LAWMIND_DAEMON).toBe("1");
    // 留着这个标志会让子进程再次 fork 自己，无限套娃。
    expect(env.LAWMIND_DAEMON_SUPERVISOR).toBeUndefined();
  });

  it("never hands loopback credentials to the tick process", () => {
    const env = buildSupervisorChildEnv(NOISY_SOURCE, { workspaceDir: "/ws" });
    expect(env.LAWMIND_LOCAL_API_TOKEN).toBeUndefined();
    expect(env.LAWMIND_SKIP_API_AUTH).toBeUndefined();
    expect(env.LAWMIND_DESKTOP_PORT).toBeUndefined();
  });

  it("never hands the derived-credential root to the tick process", () => {
    const env = buildSupervisorChildEnv(NOISY_SOURCE, { workspaceDir: "/ws" });
    expect(env.LAWMIND_LOCAL_API_INSTALLATION_SECRET).toBeUndefined();
    expect(env.LAWMIND_LOCAL_API_EPOCH).toBeUndefined();
    expect(env.LAWMIND_LOCAL_API_REVOKED_CLIENTS).toBeUndefined();
    expect(env.LAWMIND_LOCAL_API_INSTANCE_ID).toBeUndefined();
  });

  it("keeps what the tick loop genuinely needs", () => {
    const env = buildSupervisorChildEnv(NOISY_SOURCE, { workspaceDir: "/ws" });
    expect(env.PATH).toBe("/bin");
    expect(env.LAWMIND_AGENT_API_KEY).toBe("sk-keep");
    expect(env.BRAVE_API_KEY).toBe("brave-keep");
    expect(env.LAWMIND_WORKSPACE_DIR).toBe("/ws");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.SHELL).toBeUndefined();
  });

  it("carries an explicit env file path", () => {
    const env = buildSupervisorChildEnv({}, { workspaceDir: "/ws", envFile: "/ws/.env.lawmind" });
    expect(env.LAWMIND_ENV_FILE).toBe("/ws/.env.lawmind");
  });
});

describe("supervisor loop wiring sanity", () => {
  it("does not call the injected delay when nothing is scheduled", async () => {
    const delay = vi.fn(async () => {});
    await runDaemonSupervisorLoop(
      {
        spawnChild: () => ({ waitForExit: async () => ({ code: 0, signal: null }) }),
        delay,
      },
      {},
    );
    expect(delay).not.toHaveBeenCalled();
  });
});

describe("重启计数接线", () => {
  it("tells each spawned child how many restarts already happened", async () => {
    // 回归：曾经子进程永远收到 0（监督进程没把计数传进 env），于是 daemon.json
    // 的 restartCount 恒为 0，桌面「期间中断过 N 次」的回执永远不出现。
    const h = scriptedHooks([{ code: 1, signal: null }]);
    await runDaemonSupervisorLoop(h.hooks, {
      isStopping: h.isStopping,
      supervision: { maxAttempts: 3 },
    });
    // 首次启动 0，之后每次重启递增。
    expect(h.spawnRestartCounts).toEqual([0, 1, 2, 3]);
  });

  it("keeps reporting 0 when the first child exits cleanly (no restart, no count)", async () => {
    const h = scriptedHooks([{ code: 0, signal: null }]);
    await runDaemonSupervisorLoop(h.hooks, { isStopping: h.isStopping });
    expect(h.spawnRestartCounts).toEqual([0]);
  });
});

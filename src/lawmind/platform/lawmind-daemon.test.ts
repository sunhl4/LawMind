import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDaemonProcessEnv,
  getDaemonStatus,
  isPidAlive,
  markDaemonStarted,
  readDaemonState,
  setDaemonEnabled,
  stopDaemonProcess,
} from "./lawmind-daemon.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("lawmind-daemon state", () => {
  it("defaults to disabled and not running", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-daemon-"));
    dirs.push(ws);
    expect(getDaemonStatus(ws)).toMatchObject({ enabled: false, running: false });
  });

  it("persists enabled and records a live pid", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-daemon-"));
    dirs.push(ws);
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
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-daemon-"));
    dirs.push(ws);
    markDaemonStarted(ws, process.pid);
    const after = stopDaemonProcess(ws);
    expect(after.running).toBe(false);
    expect(isPidAlive(process.pid)).toBe(true);
  });
});

import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleDaemonRoutes } from "./lawmind-server-route-daemon.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import {
  DAEMON_HEARTBEAT_STALE_MS,
  markDaemonExit,
  markDaemonHeartbeat,
  markDaemonStarted,
  markDaemonSupervisionGaveUp,
} from "../../../src/lawmind/platform/lawmind-daemon.js";
import { appendDaemonLogLine } from "../../../src/lawmind/platform/lawmind-daemon-log.js";

function captureRes() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(c?: string | Buffer) {
      body += c ? c.toString() : "";
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
    get raw() {
      return body;
    },
  };
}

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(ev: string, fn: (...a: unknown[]) => void) {
      if (ev === "data" && body !== undefined) {
        fn(Buffer.from(JSON.stringify(body)));
      }
      if (ev === "end") {
        fn();
      }
      return req;
    },
  });
  return req;
}

const dirs: string[] = [];

function tmpCtx(): LawmindDispatchContext {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-daemon-route-"));
  dirs.push(workspaceDir);
  return {
    workspaceDir,
    envFile: undefined,
    userEnvPath: path.join(workspaceDir, ".env.lawmind"),
    policy: { loaded: false },
  };
}

afterEach(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
  dirs.length = 0;
});

async function call(
  ctx: LawmindDispatchContext,
  method: string,
  body?: unknown,
  opts: { pathname?: string; url?: string } = {},
): Promise<{ handled: boolean; status: number; json: () => Record<string, unknown> }> {
  const cap = captureRes();
  const pathname = opts.pathname ?? "/api/daemon";
  const handled = await handleDaemonRoutes({
    ctx,
    pathname,
    req: jsonReq(method, body),
    res: cap.res,
    url: new URL(opts.url ?? `http://127.0.0.1${pathname}`),
    c: {},
  });
  return { handled, status: cap.status, json: () => cap.json() };
}

describe("handleDaemonRoutes contract", () => {
  it("ignores paths it does not own", async () => {
    const ctx = tmpCtx();
    const cap = captureRes();
    const handled = await handleDaemonRoutes({
      ctx,
      pathname: "/api/health",
      req: jsonReq("GET"),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/health"),
      c: {},
    });
    expect(handled).toBe(false);
  });

  it("returns a quiet recap when nothing went wrong", async () => {
    const ctx = tmpCtx();
    markDaemonStarted(ctx.workspaceDir, process.pid);
    const out = await call(ctx, "GET");
    expect(out.status).toBe(200);
    const daemon = out.json().daemon as Record<string, unknown>;
    expect(daemon.enabled).toBe(true);
    expect(daemon.running).toBe(true);
    // 静默成功不打扰：没有异常时不给回执。
    expect(daemon.recap).toBeNull();
    expect(daemon.restartCount).toBe(0);
    expect(daemon.supervisionGaveUp).toBe(false);
  });

  it("surfaces a crash recap over the API so the desktop can report it", async () => {
    const ctx = tmpCtx();
    markDaemonStarted(ctx.workspaceDir, process.pid, { restartCount: 2 });
    markDaemonExit(ctx.workspaceDir, { exitClass: "crashed", detail: "exit_code=1" });

    const daemon = (await call(ctx, "GET")).json().daemon as Record<string, unknown>;
    const recap = daemon.recap as { headline: string; details: string[] };
    expect(recap).not.toBeNull();
    expect(recap.headline).toContain("已自动恢复");
    expect(recap.details.join(" ")).toContain("中断过 2 次");
    expect(daemon.lastExitClass).toBe("crashed");
  });

  it("surfaces the give-up recap, which is the one that must never be silent", async () => {
    const ctx = tmpCtx();
    markDaemonStarted(ctx.workspaceDir, process.pid, { restartCount: 5 });
    markDaemonSupervisionGaveUp(ctx.workspaceDir, {
      reason: "restart_limit_reached:5",
      attempts: 5,
    });

    const daemon = (await call(ctx, "GET")).json().daemon as Record<string, unknown>;
    const recap = daemon.recap as { headline: string; details: string[] };
    expect(daemon.supervisionGaveUp).toBe(true);
    expect(recap.headline).toContain("已停止重试");
    expect(recap.details.join(" ")).toContain("没有运行");
  });

  it("distinguishes a stalled loop from a dead process", async () => {
    const ctx = tmpCtx();
    markDaemonStarted(ctx.workspaceDir, process.pid);
    markDaemonHeartbeat(ctx.workspaceDir, new Date(Date.now() - DAEMON_HEARTBEAT_STALE_MS * 4));

    const daemon = (await call(ctx, "GET")).json().daemon as Record<string, unknown>;
    expect(daemon.running).toBe(true);
    expect(daemon.heartbeatStale).toBe(true);
    expect((daemon.recap as { headline: string }).headline).toContain("卡住");
  });

  it("keeps the recap after the desktop stops the daemon", async () => {
    const ctx = tmpCtx();
    markDaemonStarted(ctx.workspaceDir, process.pid, { restartCount: 1 });
    markDaemonExit(ctx.workspaceDir, { exitClass: "killed", detail: "signal=SIGKILL" });

    const daemon = (await call(ctx, "POST", { action: "stop" })).json().daemon as Record<
      string,
      unknown
    >;
    expect(daemon.running).toBe(false);
    expect(daemon.recap).not.toBeNull();
  });

  it("keeps the recap when the lawyer disables the daemon", async () => {
    const ctx = tmpCtx();
    markDaemonStarted(ctx.workspaceDir, process.pid, { restartCount: 3 });
    markDaemonExit(ctx.workspaceDir, { exitClass: "crashed", detail: "exit_code=1" });

    const daemon = (await call(ctx, "POST", { action: "disable" })).json().daemon as Record<
      string,
      unknown
    >;
    expect(daemon.enabled).toBe(false);
    expect(daemon.recap).not.toBeNull();
  });

  it("returns the desktop-owns-ticks message for start while the window is open", async () => {
    const ctx = tmpCtx();
    const out = await call(ctx, "POST", { action: "start" });
    expect(out.status).toBe(200);
    const payload = out.json();
    expect(payload.message).toContain("关掉 LawMind 后");
    expect((payload.daemon as Record<string, unknown>).enabled).toBe(true);
  });

  it("rejects an unknown action with 400 rather than silently succeeding", async () => {
    const ctx = tmpCtx();
    const out = await call(ctx, "POST", { action: "explode" });
    expect(out.status).toBe(400);
  });

  it("does not answer a DELETE on the daemon path", async () => {
    const ctx = tmpCtx();
    const out = await call(ctx, "DELETE");
    expect(out.handled).toBe(false);
  });
describe("后台日志读取面", () => {
  it("exposes the log tail so the lawyer is not sent to the filesystem", async () => {
    const ctx = tmpCtx();
    appendDaemonLogLine(ctx.workspaceDir, "info", "[lawmindd] 启动 pid=1");
    appendDaemonLogLine(ctx.workspaceDir, "error", "子进程退出（killed, signal=SIGKILL）");

    const out = await call(ctx, "GET", undefined, { pathname: "/api/daemon/log" });
    expect(out.status).toBe(200);
    const log = out.json().log as { lines: string[]; exists: boolean };
    expect(log.exists).toBe(true);
    expect(log.lines.join("\n")).toContain("[lawmindd] 启动");
    expect(log.lines.join("\n")).toContain("SIGKILL");
  });

  it("says the log does not exist yet instead of pretending it is empty", async () => {
    const ctx = tmpCtx();
    const out = await call(ctx, "GET", undefined, { pathname: "/api/daemon/log" });
    const log = out.json().log as { lines: string[]; exists: boolean };
    // 「还没跑过」与「跑过但没事」是两句不同的话（协议同款纪律）。
    expect(log.exists).toBe(false);
    expect(log.lines).toEqual([]);
  });

  it("clamps the requested line count so it cannot become a bulk data outlet", async () => {
    const ctx = tmpCtx();
    for (let i = 0; i < 40; i += 1) {
      appendDaemonLogLine(ctx.workspaceDir, "info", `line-${i}`);
    }
    const small = await call(ctx, "GET", undefined, {
      pathname: "/api/daemon/log",
      url: "http://127.0.0.1/api/daemon/log?lines=5",
    });
    expect((small.json().log as { lines: string[] }).lines).toHaveLength(5);

    const huge = await call(ctx, "GET", undefined, {
      pathname: "/api/daemon/log",
      url: "http://127.0.0.1/api/daemon/log?lines=999999",
    });
    // 上限 500；这里只有 40 行，所以拿全量但不超过上限。
    expect((huge.json().log as { lines: string[] }).lines.length).toBeLessThanOrEqual(500);
  });

  it("falls back to a sane default when lines is garbage", async () => {
    const ctx = tmpCtx();
    appendDaemonLogLine(ctx.workspaceDir, "info", "only-line");
    const out = await call(ctx, "GET", undefined, {
      pathname: "/api/daemon/log",
      url: "http://127.0.0.1/api/daemon/log?lines=abc",
    });
    expect(out.status).toBe(200);
    expect((out.json().log as { lines: string[] }).lines).toHaveLength(1);
  });

  it("does not answer POST on the log path", async () => {
    const ctx = tmpCtx();
    const out = await call(ctx, "POST", { action: "enable" }, { pathname: "/api/daemon/log" });
    expect(out.handled).toBe(false);
  });
});
});

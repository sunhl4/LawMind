import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleMatterReplicaRoutes } from "./lawmind-server-route-matter-replica.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const tmpDirs: string[] = [];

function tmpWorkspace(edition: "solo" | "firm"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-replica-api-"));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "lawmind.policy.json"),
    JSON.stringify({ schemaVersion: 1, edition }),
    "utf8",
  );
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function mockRes(): {
  res: http.ServerResponse;
  statusCode: number;
  body: unknown;
} {
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    statusCode: 200,
    setHeader() {
      return this;
    },
    end(chunk?: string) {
      if (chunk) {
        body = JSON.parse(chunk);
      }
      statusCode = this.statusCode;
      return this;
    },
    writeHead(code: number) {
      this.statusCode = code;
      statusCode = code;
      return this;
    },
  } as unknown as http.ServerResponse & { statusCode: number };
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

async function call(
  workspaceDir: string,
  pathname: string,
  method: string,
  query = "",
): Promise<{ statusCode: number; body: unknown }> {
  const bag = mockRes();
  const url = new URL(`http://127.0.0.1${pathname}${query}`);
  const handled = await handleMatterReplicaRoutes({
    ctx: {
      workspaceDir,
      envFile: undefined,
      userEnvPath: "",
      policy: { schemaVersion: 1 },
    },
    req: { method, headers: {} } as http.IncomingMessage,
    res: bag.res,
    url,
    pathname,
    c: {},
  } as LawmindRouteContext);
  expect(handled).toBe(true);
  return { statusCode: bag.statusCode, body: bag.body };
}

describe("matter-replica routes", () => {
  it("status is disabled on solo", async () => {
    const ws = tmpWorkspace("solo");
    const r = await call(ws, "/api/matter-replica/status", "GET");
    expect(r.statusCode).toBe(200);
    expect((r.body as { enabled: boolean }).enabled).toBe(false);
  });

  it("status is enabled on firm", async () => {
    const ws = tmpWorkspace("firm");
    const r = await call(ws, "/api/matter-replica/status", "GET");
    expect(r.statusCode).toBe(200);
    expect((r.body as { enabled: boolean }).enabled).toBe(true);
  });

  it("membership returns 403 when solo", async () => {
    const ws = tmpWorkspace("solo");
    const r = await call(ws, "/api/matter-replica/membership", "GET", "?matterId=m1");
    expect(r.statusCode).toBe(403);
  });

  it("scheduler status is readable on solo and explains why it is off", async () => {
    const ws = tmpWorkspace("solo");
    const r = await call(ws, "/api/matter-replica/scheduler", "GET");
    // 刻意不返回 403：这是只读状态，门控关闭时也要能解释原因
    expect(r.statusCode).toBe(200);
    const sched = (r.body as { scheduler: { enabled: boolean; running: boolean; autoSync: boolean } })
      .scheduler;
    expect(sched.enabled).toBe(false);
    expect(sched.running).toBe(false);
    expect(sched.autoSync).toBe(false);
  });

  it("scheduler status on firm reports autoSync, even without a running scheduler", async () => {
    const ws = tmpWorkspace("firm");
    const r = await call(ws, "/api/matter-replica/scheduler", "GET");
    expect(r.statusCode).toBe(200);
    // 测试进程里没有启动调度器 → 回退到可解释形状，而不是让 UI 猜
    const sched = (r.body as { scheduler: { enabled: boolean; autoSync: boolean; running: boolean } })
      .scheduler;
    expect(sched.enabled).toBe(true);
    expect(sched.autoSync).toBe(true);
    expect(sched.running).toBe(false);
  });

  it("scheduler tick is 409 when no scheduler is running", async () => {
    const ws = tmpWorkspace("firm");
    const r = await call(ws, "/api/matter-replica/scheduler/tick", "POST");
    expect(r.statusCode).toBe(409);
  });

  it("scheduler tick is 403 on solo (写操作仍受门控)", async () => {
    const ws = tmpWorkspace("solo");
    const r = await call(ws, "/api/matter-replica/scheduler/tick", "POST");
    expect(r.statusCode).toBe(403);
  });
});

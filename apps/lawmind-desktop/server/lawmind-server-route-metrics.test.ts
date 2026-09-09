import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleMetricsRoutes } from "./lawmind-server-route-metrics.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & { body?: unknown; status?: number } {
  const res = {
    status: 200,
    body: undefined as unknown,
    writeHead(code: number) {
      this.status = code;
    },
    end(payload?: string) {
      if (payload) {
        this.body = JSON.parse(payload);
      }
    },
  } as http.ServerResponse & { body?: unknown; status?: number };
  return res;
}

function mockPostReq(body: unknown): http.IncomingMessage {
  const req = { method: "POST", headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

describe("lawmind-server-route-metrics", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-metrics-route-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("GET /api/metrics/north-star returns snapshot", async () => {
    const res = mockRes();
    const handled = await handleMetricsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/metrics/north-star"),
      pathname: "/api/metrics/north-star",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      schemaVersion: 2,
      firstPassRate: null,
      lintEscapeRate: null,
    });
  });

  it("GET /api/metrics/team-growth returns dashboard", async () => {
    const res = mockRes();
    const handled = await handleMetricsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/metrics/team-growth?windowDays=14"),
      pathname: "/api/metrics/team-growth",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      windowDays: 14,
      metrics: expect.any(Array),
      assistants: expect.any(Array),
      baseline: null,
    });
  });

  it("POST /api/metrics/team-growth/baseline freezes baseline", async () => {
    const res = mockRes();
    const handled = await handleMetricsRoutes({
      ctx,
      req: mockPostReq({ windowDays: 7, note: "v1" }),
      res,
      url: new URL("http://127.0.0.1/api/metrics/team-growth/baseline"),
      pathname: "/api/metrics/team-growth/baseline",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      windowDays: 7,
      baseline: { note: "v1", windowDays: 7 },
      baselineFile: { version: 1, note: "v1" },
    });
  });

  it("GET /api/metrics/lawyer-dashboard returns matter metrics", async () => {
    const res = mockRes();
    const handled = await handleMetricsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/metrics/lawyer-dashboard?matterId=m-1"),
      pathname: "/api/metrics/lawyer-dashboard",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      metrics: {
        matterId: "m-1",
        lintCoverageRate: null,
        editRate: null,
        firstPassRate: null,
        pendingApprovals: 0,
        overdueTasks: 0,
      },
    });
  });

  it("GET /api/metrics/lawyer-dashboard returns global desk dashboard", async () => {
    const res = mockRes();
    const handled = await handleMetricsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/metrics/lawyer-dashboard"),
      pathname: "/api/metrics/lawyer-dashboard",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      dashboard: {
        items: expect.any(Array),
        totalPendingApprovals: expect.any(Number),
        totalOverdueTasks: expect.any(Number),
        todayActivityCount: expect.any(Number),
        thisWeekFirstPassCount: expect.any(Number),
      },
    });
  });
});

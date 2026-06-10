import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { handleRedlineRoutes } from "./lawmind-server-route-redline.js";
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

describe("lawmind-server-route-redline", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-redline-"));
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

  it("GET /api/drafts/:id/redline returns empty proposal when none saved", async () => {
    const res = mockRes();
    const handled = await handleRedlineRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/drafts/task-redline-1/redline"),
      pathname: "/api/drafts/task-redline-1/redline",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, proposal: null });
  });

  it("GET /api/drafts/:id/redline returns 400 for unsafe task id", async () => {
    const res = mockRes();
    const handled = await handleRedlineRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/drafts/task%20space/redline"),
      pathname: "/api/drafts/task space/redline",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(400);
  });
});

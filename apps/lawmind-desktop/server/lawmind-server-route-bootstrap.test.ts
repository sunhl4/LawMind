import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { handleBootstrapRoute } from "./lawmind-server-route-bootstrap.js";

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

describe("lawmind-server-route-bootstrap", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-bootstrap-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
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

  it("returns aggregated bootstrap payload", async () => {
    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    const handled = await handleBootstrapRoute({
      ctx,
      req,
      res,
      url: new URL("http://127.0.0.1/api/bootstrap"),
      pathname: "/api/bootstrap",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      health: { modelConfigured: expect.any(Boolean) },
      edition: { id: expect.any(String), features: expect.any(Object) },
      assistants: expect.any(Array),
      records: { taskCount: 0, draftCount: 0, matterCount: 0, pendingReviewCount: 0 },
    });
  });

  it("ignores non-bootstrap paths", async () => {
    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    expect(
      await handleBootstrapRoute({
        ctx,
        req,
        res,
        url: new URL("http://127.0.0.1/api/health"),
        pathname: "/api/health",
        c: {},
      }),
    ).toBe(false);
  });
});

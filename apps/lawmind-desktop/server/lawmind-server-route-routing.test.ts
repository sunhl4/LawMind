import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRoutingRoutes } from "./lawmind-server-route-routing.js";
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

function createJsonRequest(method: string, body?: unknown): http.IncomingMessage {
  return {
    method,
    headers: { "content-type": "application/json" },
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data" && body !== undefined) {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  } as unknown as http.IncomingMessage;
}

describe("lawmind-server-route-routing", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-routing-"));
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

  it("GET /api/routing/defaults returns table", async () => {
    const res = mockRes();
    const handled = await handleRoutingRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/routing/defaults"),
      pathname: "/api/routing/defaults",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, defaults: { version: 1 } });
  });

  it("POST /api/routing/resolve returns fallback", async () => {
    const res = mockRes();
    const handled = await handleRoutingRoutes({
      ctx,
      req: createJsonRequest("POST", {
        kind: "contract.review",
        fallbackAssistantId: "shell",
      }),
      res,
      url: new URL("http://127.0.0.1/api/routing/resolve"),
      pathname: "/api/routing/resolve",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, assistantId: "shell", source: "fallback" });
  });
});

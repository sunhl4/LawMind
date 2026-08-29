import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { handleMemoryAdoptionRoutes } from "./lawmind-server-route-memory-adoption.js";
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

describe("lawmind-server-route-memory-adoption", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-memory-adoption-"));
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

  it("GET /api/memory/adoption lists suggestions", async () => {
    const res = mockRes();
    const handled = await handleMemoryAdoptionRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption"),
      pathname: "/api/memory/adoption",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, items: expect.any(Array) });
  });

  it("POST /api/memory/adoption/suggest returns 400 without body", async () => {
    const res = mockRes();
    const handled = await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq(null),
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption/suggest"),
      pathname: "/api/memory/adoption/suggest",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(400);
  });

  it("POST /api/memory/adoption/adopt writes case.progress to session-summary", async () => {
    const { suggestMemoryAdoption } = await import(
      "../../../src/lawmind/memory/adoption-service.js"
    );
    const rec = await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      {
        scope: "matter",
        kind: "case.progress",
        targetId: "matter-adopt",
        payload: "### 沉淀\n\n律师：请记住对方主张适用仲裁。",
        origin: "agent",
      },
      { autoAdopt: false },
    );
    const res = mockRes();
    const handled = await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq({ id: rec.id }),
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption/adopt"),
      pathname: "/api/memory/adoption/adopt",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const summary = await fs.readFile(
      path.join(workspaceDir, "cases", "matter-adopt", "session-summary.md"),
      "utf8",
    );
    expect(summary).toContain("仲裁");
  });
});

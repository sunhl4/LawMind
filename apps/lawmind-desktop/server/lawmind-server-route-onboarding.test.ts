import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { handleOnboardingRoutes } from "./lawmind-server-route-onboarding.js";
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

describe("lawmind-server-route-onboarding", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-onboarding-"));
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

  it("POST /api/onboarding/firstrun-wizard returns 400 for invalid matterId", async () => {
    const res = mockRes();
    const handled = await handleOnboardingRoutes({
      ctx,
      req: mockPostReq({ matterId: "bad id" }),
      res,
      url: new URL("http://127.0.0.1/api/onboarding/firstrun-wizard"),
      pathname: "/api/onboarding/firstrun-wizard",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(400);
  });

  it("POST /api/onboarding/firstrun-wizard succeeds when case dir exists", async () => {
    const matterId = "onboard-matter-01";
    await fs.mkdir(path.join(workspaceDir, "cases", matterId), { recursive: true });
    const res = mockRes();
    const handled = await handleOnboardingRoutes({
      ctx,
      req: mockPostReq({ matterId }),
      res,
      url: new URL("http://127.0.0.1/api/onboarding/firstrun-wizard"),
      pathname: "/api/onboarding/firstrun-wizard",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});

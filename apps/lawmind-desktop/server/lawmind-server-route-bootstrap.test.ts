import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { handleBootstrapRoute } from "./lawmind-server-route-bootstrap.js";
import type { LawMindPolicyFile } from "./lawmind-policy.js";

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
    const handled = handleBootstrapRoute({
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
      health: { modelConfigured: expect.any(Boolean), modelVerified: expect.any(Boolean) },
      edition: { id: expect.any(String), features: expect.any(Object) },
      assistants: expect.any(Array),
      presets: expect.any(Array),
    });
    expect(res.body).not.toHaveProperty("records");
    expect((res.body as { health?: { doctor?: unknown } }).health).not.toHaveProperty("doctor");
  });

  it("exposes the 起草大模型 switch so the settings checkbox survives /api/bootstrap", async () => {
    const lawMindRoot = path.join(workspaceDir, "LawMind");
    await fs.mkdir(lawMindRoot, { recursive: true });
    await fs.writeFile(
      path.join(lawMindRoot, "models.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        customModels: [],
        verifications: {},
        draftWithModelEnabled: true,
      })}\n`,
      "utf8",
    );
    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    const handled = handleBootstrapRoute({
      ctx: { ...ctx, envFile: path.join(lawMindRoot, ".env.lawmind") },
      req,
      res,
      url: new URL("http://127.0.0.1/api/bootstrap"),
      pathname: "/api/bootstrap",
      c: {},
    });
    expect(handled).toBe(true);
    // 渲染层只读 bootstrap 的 health；缺这两个字段会让勾选框永远回到未勾选。
    expect(res.body).toMatchObject({
      health: { draftWithModelEnabled: true, draftWithModelActive: expect.any(Boolean) },
    });
  });

  it("carries 联网检索 / 策略标志 so the settings pill and 联网 toggle are truthful", async () => {
    const policy: LawMindPolicyFile = { schemaVersion: 1, allowWebSearch: false };
    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    const handled = handleBootstrapRoute({
      ctx: {
        ...ctx,
        policy: { loaded: true, path: path.join(workspaceDir, "lawmind.policy.json"), applied: [], policy },
      },
      req,
      res,
      url: new URL("http://127.0.0.1/api/bootstrap"),
      pathname: "/api/bootstrap",
      c: {},
    });
    expect(handled).toBe(true);
    // mapHealthState 读这三个字段 + policy.allowWebSearch 来判定是否已就绪 / 是否被策略禁止。
    expect(res.body).toMatchObject({
      health: {
        webSearchReady: expect.any(Boolean),
        webSearchNativeAvailable: expect.any(Boolean),
        webSearchApiKeyConfigured: expect.any(Boolean),
        policy: { loaded: true, allowWebSearch: false },
      },
    });
  });

  it("ignores non-bootstrap paths", async () => {    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    expect(
      handleBootstrapRoute({
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

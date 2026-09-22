/**
 * 本地 API 鉴权边界：Word 插件任务窗格静态资源不带 bearer（Word 取页面时还没有令牌），
 * 但数据面与变更类请求照旧必须带令牌。
 */
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveLocalApiCredential } from "../electron/local-api-credentials.mjs";
import { initLocalApiCredentialsFromEnv } from "./lawmind-local-api-auth.js";
import { lawmindHandleHttpRequest } from "./lawmind-server-dispatch.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

type MockRes = http.ServerResponse & { status?: number; raw?: string };

function mockRes(): MockRes {
  return {
    status: 200,
    raw: undefined as string | undefined,
    writeHead(code: number) {
      (this as MockRes).status = code;
    },
    end(payload?: string) {
      (this as MockRes).raw = payload;
    },
  } as MockRes;
}

function mockReq(method: string, url: string, token?: string): http.IncomingMessage {
  const headers: Record<string, string> = {
    host: "localhost:52100",
    "content-type": "application/json",
  };
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  const req = {
    method,
    url,
    headers,
  } as http.IncomingMessage & { on?: unknown };
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify({ path: "/tmp/合同.docx" })));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

describe("loopback auth boundary for the Word add-in", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;
  let prevSkip: string | undefined;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-addin-auth-"));
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
    prevSkip = process.env.LAWMIND_SKIP_API_AUTH;
    delete process.env.LAWMIND_SKIP_API_AUTH;
  });

  afterEach(async () => {
    if (prevSkip === undefined) {
      delete process.env.LAWMIND_SKIP_API_AUTH;
    } else {
      process.env.LAWMIND_SKIP_API_AUTH = prevSkip;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("serves the task pane without a bearer token", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(ctx, mockReq("GET", "/word-addin/taskpane.html"), res);
    expect(res.status).toBe(200);
    expect(res.raw ?? "").toContain("LawMind 就地审查");
  });

  it("still requires a bearer token for the add-in data plane", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(ctx, mockReq("POST", "/api/word-addin/reviews"), res);
    expect(res.status).toBe(401);
    expect(res.raw ?? "").toContain("invalid_api_token");
  });

  it("does not exempt non-GET requests on the static path", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(ctx, mockReq("POST", "/word-addin/taskpane.html"), res);
    expect(res.status).toBe(401);
  });
});

/**
 * 客户端身份、最小权限与发现端点（P1–P3）。
 *
 * 这三件事共同把本地 API 从「一个共享口令」升级成「有身份、可发现、可单独吊销」的
 * 服务边界：认出是谁 → 才知道它能不能碰这条路由 → 客户端还能自己重新发现坐标。
 */
describe("本机 API：客户端身份与最小权限", () => {
  const SECRET = "d".repeat(64);
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-client-scope-"));
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
    delete process.env.LAWMIND_SKIP_API_AUTH;
    delete process.env.LAWMIND_PACKAGED;
    process.env.LAWMIND_LOCAL_API_INSTALLATION_SECRET = SECRET;
    process.env.LAWMIND_LOCAL_API_EPOCH = "1";
    delete process.env.LAWMIND_LOCAL_API_REVOKED_CLIENTS;
    initLocalApiCredentialsFromEnv();
  });

  afterEach(async () => {
    delete process.env.LAWMIND_LOCAL_API_INSTALLATION_SECRET;
    delete process.env.LAWMIND_LOCAL_API_EPOCH;
    initLocalApiCredentialsFromEnv();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  const cred = (clientId: string) => deriveLocalApiCredential(SECRET, clientId, 1);

  it("发现端点免 bearer，且载荷里没有任何秘密", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(ctx, mockReq("GET", "/.well-known/lawmind-local"), res);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.raw ?? "{}");
    expect(body.clients).toContain("word-addin");
    expect(body.instanceId).toBeTruthy();
    expect(body.epoch).toBe(1);
    // 关键：发现端点绝不能把凭据或安装密钥漏出去。
    const raw = res.raw ?? "";
    expect(raw).not.toContain(SECRET);
    for (const clientId of ["renderer", "word-addin", "cli"]) {
      expect(raw).not.toContain(cred(clientId));
    }
  });

  it("插件凭据能进自己的数据面", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(
      ctx,
      mockReq("POST", "/api/word-addin/reviews", cred("word-addin")),
      res,
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("插件凭据越界访问案卷 ⇒ 403（最小权限，默认拒绝）", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(
      ctx,
      mockReq("POST", "/api/matters/create", cred("word-addin")),
      res,
    );
    expect(res.status).toBe(403);
    expect(res.raw ?? "").toContain("client_scope_forbidden");
  });

  it("cli 凭据只读：GET 放行，写操作 403", async () => {
    const readRes = mockRes();
    await lawmindHandleHttpRequest(ctx, mockReq("GET", "/api/health", cred("cli")), readRes);
    expect(readRes.status).not.toBe(401);
    expect(readRes.status).not.toBe(403);

    const writeRes = mockRes();
    await lawmindHandleHttpRequest(
      ctx,
      mockReq("POST", "/api/matters/create", cred("cli")),
      writeRes,
    );
    expect(writeRes.status).toBe(403);
  });

  it("renderer 凭据全量（渲染层无需改动即可继续工作）", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(ctx, mockReq("GET", "/api/health", cred("renderer")), res);
    expect(res.status).toBe(200);
  });

  it("别把客户端的凭据（换一把密钥签的）一律 401", async () => {
    const res = mockRes();
    await lawmindHandleHttpRequest(
      ctx,
      mockReq("GET", "/api/health", deriveLocalApiCredential("e".repeat(64), "renderer", 1)),
      res,
    );
    expect(res.status).toBe(401);
  });

  it("被吊销的客户端立刻 403/401，其他客户端不受影响", async () => {
    process.env.LAWMIND_LOCAL_API_REVOKED_CLIENTS = "word-addin";
    initLocalApiCredentialsFromEnv();

    const revoked = mockRes();
    await lawmindHandleHttpRequest(
      ctx,
      mockReq("GET", "/api/word-addin/reviews", cred("word-addin")),
      revoked,
    );
    // 凭据认不出来 ⇒ 401（吊销后连身份都不成立）。
    expect(revoked.status).toBe(401);

    const kept = mockRes();
    await lawmindHandleHttpRequest(ctx, mockReq("GET", "/api/health", cred("renderer")), kept);
    expect(kept.status).toBe(200);
  });
});

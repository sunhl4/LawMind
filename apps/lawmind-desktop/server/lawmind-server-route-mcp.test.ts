import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllAuditLogs } from "../../../src/lawmind/audit/index.js";
import { readMcpServersConfig } from "../../../src/lawmind/mcp/mcp-servers-config.js";
import { handleMcpRoutes } from "./lawmind-server-route-mcp.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockJsonReq(payload: unknown, method = "PUT"): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(payload)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

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

describe("lawmind-server-route-mcp", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lm-mcp-route-"));
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("PUT then GET servers", async () => {
    const putRes = mockRes();
    const put = await handleMcpRoutes({
      ctx,
      req: mockJsonReq({
        confirmCommandExecution: true,
        servers: [
          {
            id: "alpha",
            label: "A",
            transport: "stdio",
            command: "node",
            args: ["x.mjs"],
            enabled: false,
            allowWrites: false,
          },
        ],
      }),
      res: putRes,
      url: new URL("http://127.0.0.1/api/mcp/servers"),
      pathname: "/api/mcp/servers",
      c: {},
    });
    expect(put).toBe(true);
    expect(putRes.status).toBe(200);

    const getRes = mockRes();
    await handleMcpRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: getRes,
      url: new URL("http://127.0.0.1/api/mcp/servers"),
      pathname: "/api/mcp/servers",
      c: {},
    });
    const body = getRes.body as { servers?: Array<{ id: string }> };
    expect(body.servers?.map((s) => s.id)).toContain("alpha");
  });

  it("rejects a shell command on PUT", async () => {
    const putRes = mockRes();
    await handleMcpRoutes({
      ctx,
      req: mockJsonReq({
        confirmCommandExecution: true,
        servers: [
          {
            id: "bad",
            label: "B",
            transport: "stdio",
            command: "bash",
            args: ["-c", "id"],
            enabled: false,
            allowWrites: false,
          },
        ],
      }),
      res: putRes,
      url: new URL("http://127.0.0.1/api/mcp/servers"),
      pathname: "/api/mcp/servers",
      c: {},
    });
    expect(putRes.status).toBe(400);
  });

  it("stdio command 缺 confirmCommandExecution 时被拒（任意命令执行的最小摩擦）", async () => {
    const putRes = mockRes();
    await handleMcpRoutes({
      ctx,
      req: mockJsonReq({
        servers: [
          {
            id: "alpha",
            label: "A",
            transport: "stdio",
            command: "node",
            args: ["x.mjs"],
            enabled: false,
            allowWrites: false,
          },
        ],
      }),
      res: putRes,
      url: new URL("http://127.0.0.1/api/mcp/servers"),
      pathname: "/api/mcp/servers",
      c: {},
    });
    expect(putRes.status).toBe(400);
    const body = putRes.body as { ok: boolean; error?: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("confirm_command_execution_required");
    expect(body.message).toMatch(/本机命令执行/);
    // 未写入配置。
    expect(readMcpServersConfig(workspaceDir)).toHaveLength(0);
  });

  it("有确认字段时写入成功、响应带安全提示且审计落盘（含 command/args）", async () => {
    const putRes = mockRes();
    await handleMcpRoutes({
      ctx,
      req: mockJsonReq({
        confirmCommandExecution: true,
        servers: [
          {
            id: "alpha",
            label: "A",
            transport: "stdio",
            command: "node",
            args: ["x.mjs", "--flag"],
            enabled: true,
            allowWrites: false,
          },
        ],
      }),
      res: putRes,
      url: new URL("http://127.0.0.1/api/mcp/servers"),
      pathname: "/api/mcp/servers",
      c: {},
    });
    expect(putRes.status).toBe(200);
    const body = putRes.body as { ok: boolean; securityNote?: string };
    expect(body.ok).toBe(true);
    expect(body.securityNote).toMatch(/本机命令执行/);

    const events = await readAllAuditLogs(path.join(workspaceDir, "audit"));
    const audit = events.find((e) => e.kind === "mcp.servers_updated");
    expect(audit).toBeTruthy();
    expect(audit?.detail).toContain('"command":"node"');
    expect(audit?.detail).toContain('"--flag"');
  });

  it("纯 http 服务器无需 confirmCommandExecution", async () => {
    const putRes = mockRes();
    await handleMcpRoutes({
      ctx,
      req: mockJsonReq({
        servers: [
          {
            id: "localhttp",
            label: "L",
            transport: "http",
            url: "http://127.0.0.1:9/mcp",
            enabled: false,
            allowWrites: false,
          },
        ],
      }),
      res: putRes,
      url: new URL("http://127.0.0.1/api/mcp/servers"),
      pathname: "/api/mcp/servers",
      c: {},
    });
    expect(putRes.status).toBe(200);
  });
});

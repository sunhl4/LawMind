import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleAuditEventRoute } from "./lawmind-server-route-audit-event.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function parseJsonDetail(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

function createResponseCapture() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(nextStatus: number, headers: Record<string, string>) {
      status = nextStatus;
      void headers;
      return this;
    },
    end(chunk?: string | Buffer) {
      body += chunk ? chunk.toString() : "";
      return this;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const req = { method, headers: { "content-type": "application/json" } } as http.IncomingMessage;
  Object.assign(req, {
    on(ev: string, fn: (...a: unknown[]) => void) {
      if (ev === "data" && body !== undefined) {
        fn(Buffer.from(JSON.stringify(body)));
      }
      if (ev === "end") {
        fn();
      }
      return req;
    },
  });
  return req;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-event-"));
}

describe("handleAuditEventRoute", () => {
  afterEach(() => {
    delete process.env.LAWMIND_AUDIT_HASH_CHAIN_KEY;
  });

  it("writes outbound_http event to workspace audit log", async () => {
    const workspaceDir = tmpDir();
    try {
      const capture = createResponseCapture();
      const ctx: LawmindDispatchContext = {
        workspaceDir,
        envFile: undefined,
        userEnvPath: "",
        policy: { loaded: false },
      };
      const handled = await handleAuditEventRoute({
        ctx,
        req: jsonReq("POST", {
          kind: "outbound_http",
          taskId: "renderer",
          actor: "lawyer",
          detail: JSON.stringify({ method: "GET", host: "127.0.0.1", pathname: "/api/test", status: 200, durationMs: 5 }),
        }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/audit/event"),
        pathname: "/api/audit/event",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toEqual({ ok: true });

      const auditDir = path.join(workspaceDir, "audit");
      const files = fs.readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
      expect(files.length).toBe(1);
      const lines = fs.readFileSync(path.join(auditDir, files[0]), "utf8").split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      const event = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(event.kind).toBe("outbound_http");
      expect(event.taskId).toBe("renderer");
      expect(event.actor).toBe("lawyer");
      const detail = parseJsonDetail(event.detail);
      expect(detail.method).toBe("GET");
      expect(detail.status).toBe(200);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("returns 400 for invalid body", async () => {
    const workspaceDir = tmpDir();
    try {
      const capture = createResponseCapture();
      const ctx: LawmindDispatchContext = {
        workspaceDir,
        envFile: undefined,
        userEnvPath: "",
        policy: { loaded: false },
      };
      const handled = await handleAuditEventRoute({
        ctx,
        req: jsonReq("POST", { kind: "unknown_kind" }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/audit/event"),
        pathname: "/api/audit/event",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(400);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  /**
   * `actor` 必须落在**审计链的 actor 契约**内。
   *
   * 此前 schema 允许 `assistant` / `automation`，而这两者在 `AuditEvent.actor`
   * 里不存在、全仓也从未使用过 —— 端点能写出一个审计链不认识的 actor，
   * 下游（哈希链校验 / Doctor 汇总）无法归类，写入时却毫无阻力。
   * 「哪个助手」靠 `actorId`（`assistant:<id>`）表达，不靠 actor。
   */
  it("对审计链不认识的 actor 返回 400（不写出一条无主的审计事件）", async () => {
    const workspaceDir = tmpDir();
    try {
      for (const actor of ["assistant", "automation", "nobody"]) {
        const capture = createResponseCapture();
        const handled = await handleAuditEventRoute({
          ctx: { workspaceDir, envFile: undefined, userEnvPath: "", policy: { loaded: false } },
          req: jsonReq("POST", {
            kind: "outbound_http",
            taskId: "t-1",
            actor,
            detail: "{}",
          }),
          res: capture.res,
          url: new URL("http://127.0.0.1/api/audit/event"),
          pathname: "/api/audit/event",
          c: {},
        });
        expect(handled).toBe(true);
        expect(capture.status, `actor=${actor} 必须被拒`).toBe(400);
      }
      // 拒掉之后审计目录里不应留下任何事件文件。
      const auditDir = path.join(workspaceDir, "audit");
      const written = fs.existsSync(auditDir) ? fs.readdirSync(auditDir) : [];
      expect(written).toEqual([]);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("三个合法 actor（system / lawyer / model）都仍被接受", async () => {
    const workspaceDir = tmpDir();
    try {
      for (const actor of ["system", "lawyer", "model"]) {
        const capture = createResponseCapture();
        await handleAuditEventRoute({
          ctx: { workspaceDir, envFile: undefined, userEnvPath: "", policy: { loaded: false } },
          req: jsonReq("POST", {
            kind: "outbound_http",
            taskId: "t-1",
            actor,
            detail: "{}",
          }),
          res: capture.res,
          url: new URL("http://127.0.0.1/api/audit/event"),
          pathname: "/api/audit/event",
          c: {},
        });
        expect(capture.status, `actor=${actor} 必须被接受`).toBe(200);
      }
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("does not handle GET /api/audit/event", async () => {
    const workspaceDir = tmpDir();
    try {
      const capture = createResponseCapture();
      const handled = await handleAuditEventRoute({
        ctx: { workspaceDir, envFile: undefined, userEnvPath: "", policy: { loaded: false } },
        req: jsonReq("GET"),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/audit/event"),
        pathname: "/api/audit/event",
        c: {},
      });
      expect(handled).toBe(false);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});

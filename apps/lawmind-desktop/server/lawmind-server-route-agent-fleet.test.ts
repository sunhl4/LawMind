import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { handleAgentFleetRoutes } from "./lawmind-server-route-agent-fleet.js";
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

describe("lawmind-server-route-agent-fleet", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-agent-fleet-"));
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

  it("GET /api/agent-fleet returns summary with growth", async () => {
    const res = mockRes();
    const handled = await handleAgentFleetRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/agent-fleet?windowDays=30"),
      pathname: "/api/agent-fleet",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      growth: { windowDays: 30, assistants: expect.any(Array) },
    });
  });

  it("GET /api/assistants/growth returns windowed report", async () => {
    const res = mockRes();
    const handled = await handleAgentFleetRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/assistants/growth?windowDays=14"),
      pathname: "/api/assistants/growth",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, windowDays: 14, assistants: expect.any(Array) });
  });

  it("GET /api/agent-presets returns presets list", async () => {
    const res = mockRes();
    const handled = await handleAgentFleetRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/agent-presets"),
      pathname: "/api/agent-presets",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, presets: expect.any(Array) });
  });

  it("GET /api/agent-fleet rejects invalid matterId", async () => {
    const res = mockRes();
    const handled = await handleAgentFleetRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/agent-fleet?matterId=../evil"),
      pathname: "/api/agent-fleet",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(400);
  });

  it("GET /api/sessions/:id/fleet-transcript returns 404 when session missing", async () => {
    const res = mockRes();
    const handled = await handleAgentFleetRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/sessions/no-such-session/fleet-transcript"),
      pathname: "/api/sessions/no-such-session/fleet-transcript",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false });
  });

  it("GET /api/sessions/:id/fleet-transcript returns messages and pending actions", async () => {
    const { createSession, saveSession } = await import(
      "../../../src/lawmind/agent/session.js"
    );
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-fleet-1",
    });
    session.conversationHistory.push(
      { role: "user", content: "请审查 NDA" },
      { role: "assistant", content: "已开始检索。" },
      { role: "system", content: "should-be-filtered" },
    );
    session.pendingRequiresAction = [
      {
        id: "ra-fleet-1",
        kind: "tool_approval",
        threadId: "t1",
        title: "待批准",
        summary: "导出 Word",
        toolName: "render_document",
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    session.turns = [
      {
        turnId: "turn-1",
        status: "awaiting_approval",
        startedAt: new Date().toISOString(),
        executionState: { status: "awaiting_approval", steps: [] },
      },
    ];
    saveSession(workspaceDir, session);

    const res = mockRes();
    const handled = await handleAgentFleetRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL(
        `http://127.0.0.1/api/sessions/${session.sessionId}/fleet-transcript`,
      ),
      pathname: `/api/sessions/${session.sessionId}/fleet-transcript`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      sessionId: session.sessionId,
      matterId: "matter-fleet-1",
      assistantId: "default",
      messages: [
        { role: "user", content: "请审查 NDA" },
        { role: "assistant", content: "已开始检索。" },
      ],
      executionState: { status: "awaiting_approval" },
    });
    const body = res.body as {
      pendingRequiresAction?: Array<{ id: string }>;
      messages?: Array<{ role: string }>;
    };
    expect(body.pendingRequiresAction?.some((a) => a.id === "ra-fleet-1")).toBe(true);
    expect(body.messages?.every((m) => m.role === "user" || m.role === "assistant")).toBe(
      true,
    );
  });

  it("GET /api/sessions/:id/fleet-transcript does not leak other workspace sessions", async () => {
    const { createSession, saveSession } = await import(
      "../../../src/lawmind/agent/session.js"
    );
    const otherWs = await fs.mkdtemp(path.join("/tmp", "lawmind-agent-fleet-other-"));
    try {
      const session = createSession({
        workspaceDir: otherWs,
        actorId: "lawyer",
        assistantId: "default",
      });
      saveSession(otherWs, session);
      const res = mockRes();
      const handled = await handleAgentFleetRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res,
        url: new URL(
          `http://127.0.0.1/api/sessions/${session.sessionId}/fleet-transcript`,
        ),
        pathname: `/api/sessions/${session.sessionId}/fleet-transcript`,
        c: {},
      });
      expect(handled).toBe(true);
      expect(res.status).toBe(404);
    } finally {
      await fs.rm(otherWs, { recursive: true, force: true });
    }
  });
});

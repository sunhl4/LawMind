import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, saveSession } from "../../../src/lawmind/agent/session.js";
import type { LawMindRequiresActionDecision } from "../../../src/lawmind/platform/requires-action.js";
import { requestApproval } from "../../../src/lawmind/application/services/approval-service.js";
import { LawmindSseBus } from "./lawmind-sse-bus.js";
import { handleApprovalRoutes } from "./lawmind-server-route-approvals.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

const mockResumeTurn = vi.fn();

vi.mock("../../../src/lawmind/agent/runtime-resume.js", async () => {
  return {
    resumeTurn: (...args: unknown[]) => mockResumeTurn(...args),
  };
});

function mockJsonReq(payload: unknown): http.IncomingMessage {
  const req = { method: "POST", headers: {} } as http.IncomingMessage;
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

function createToolApprovalAction(id: string, toolName: string, sessionId: string, matterId?: string) {
  return {
    id,
    kind: "tool_approval" as const,
    threadId: `${matterId ?? "_"}:_:${sessionId}`,
    title: `待批准：${toolName}`,
    summary: "请确认后再继续。",
    matterId,
    sessionId,
    toolName,
    toolCallId: `tc-${id}`,
    toolArgs: { to: "client@example.com", subject: "审阅稿", body: "正文内容" },
    decisions: ["approve", "reject"] as LawMindRequiresActionDecision[],
    createdAt: new Date().toISOString(),
  };
}

describe("lawmind-server-route-approvals", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;
  let sseBus: LawmindSseBus;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-approvals-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    sseBus = new LawmindSseBus();
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
      sseBus,
    };
    mockResumeTurn.mockReset();
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "sk-test");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "demo");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    vi.unstubAllEnvs();
  });

  it("returns false for unrelated routes", async () => {
    const res = mockRes();
    const handled = await handleApprovalRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/other"),
      pathname: "/api/other",
      c: {},
    });
    expect(handled).toBe(false);
  });

  it("GET /api/approvals lists pending tool and matter approvals", async () => {
    // Matter approval
    requestApproval(workspaceDir, {
      matterId: "matter-a",
      requestedBy: "lawyer-1",
      reason: "请签批合同",
      riskLevel: "high",
    });

    // Tool approval via session
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      matterId: "matter-a",
    });
    session.pendingRequiresAction = [
      createToolApprovalAction("tool-act-1", "send_email", session.sessionId, "matter-a"),
    ];
    saveSession(workspaceDir, session);

    const res = mockRes();
    const handled = await handleApprovalRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/approvals"),
      pathname: "/api/approvals",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; items: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(2);
    const kinds = body.items.map((i) => i.kind);
    expect(kinds).toContain("tool_approval");
    expect(kinds).toContain("matter_approval");
    const toolItem = body.items.find((i) => i.kind === "tool_approval");
    expect(toolItem).toMatchObject({
      toolName: "send_email",
      riskLevel: "high",
      decisions: ["approve", "reject", "more_info"],
    });
  });

  it("GET /api/approvals?matterId= filters tool and matter rows", async () => {
    requestApproval(workspaceDir, {
      matterId: "matter-a",
      requestedBy: "lawyer-1",
      reason: "本案签批",
      riskLevel: "low",
    });
    requestApproval(workspaceDir, {
      matterId: "matter-b",
      requestedBy: "lawyer-1",
      reason: "他案签批",
      riskLevel: "low",
    });
    const sessionA = createSession({
      workspaceDir,
      actorId: "lawyer",
      matterId: "matter-a",
    });
    sessionA.pendingRequiresAction = [
      createToolApprovalAction("tool-a", "send_email", sessionA.sessionId, "matter-a"),
    ];
    saveSession(workspaceDir, sessionA);
    const sessionB = createSession({
      workspaceDir,
      actorId: "lawyer",
      matterId: "matter-b",
    });
    sessionB.pendingRequiresAction = [
      createToolApprovalAction("tool-b", "send_email", sessionB.sessionId, "matter-b"),
    ];
    saveSession(workspaceDir, sessionB);

    const res = mockRes();
    await handleApprovalRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/approvals?matterId=matter-a"),
      pathname: "/api/approvals",
      c: {},
    });
    const body = res.body as { items: Array<{ matterId?: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.matterId === "matter-a")).toBe(true);
  });

  it("POST /api/approvals/:id/approve resolves a matter approval", async () => {
    const created = requestApproval(workspaceDir, {
      matterId: "matter-b",
      requestedBy: "lawyer-1",
      reason: "签批",
      riskLevel: "medium",
    });

    const res = mockRes();
    const handled = await handleApprovalRoutes({
      ctx,
      req: mockJsonReq({}),
      res,
      url: new URL(`http://127.0.0.1/api/approvals/${encodeURIComponent(created.approvalId)}/approve`),
      pathname: `/api/approvals/${created.approvalId}/approve`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; approval?: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.approval).toMatchObject({ status: "approved" });
  });

  it("POST /api/approvals/:id/reject rejects a matter approval", async () => {
    const created = requestApproval(workspaceDir, {
      matterId: "matter-c",
      requestedBy: "lawyer-1",
      reason: "签批",
      riskLevel: "low",
    });

    const res = mockRes();
    await handleApprovalRoutes({
      ctx,
      req: mockJsonReq({}),
      res,
      url: new URL(`http://127.0.0.1/api/approvals/${encodeURIComponent(created.approvalId)}/reject`),
      pathname: `/api/approvals/${created.approvalId}/reject`,
      c: {},
    });
    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; approval?: Record<string, unknown> };
    expect(body.approval).toMatchObject({ status: "rejected" });
  });

  it("POST /api/approvals/:id/approve for tool approval resumes the turn", async () => {
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      matterId: "matter-d",
    });
    const action = createToolApprovalAction("tool-act-2", "send_email", session.sessionId, "matter-d");
    session.pendingRequiresAction = [action];
    saveSession(workspaceDir, session);

    mockResumeTurn.mockResolvedValue({
      turn: { status: "completed", turnId: "turn-1" },
      reply: "已发送。",
      sessionId: session.sessionId,
      memoryContext: {},
    });

    const res = mockRes();
    await handleApprovalRoutes({
      ctx,
      req: mockJsonReq({}),
      res,
      url: new URL(`http://127.0.0.1/api/approvals/${encodeURIComponent(action.id)}/approve`),
      pathname: `/api/approvals/${action.id}/approve`,
      c: {},
    });
    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; turn?: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.turn).toMatchObject({ status: "completed" });
    expect(mockResumeTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        sessionId: session.sessionId,
        actionId: action.id,
        decision: "approve",
      }),
      expect.any(Object),
    );
  });

  it("emits approval:update after resolving", async () => {
    const created = requestApproval(workspaceDir, {
      matterId: "matter-e",
      requestedBy: "lawyer-1",
      reason: "签批",
      riskLevel: "high",
    });

    const events: Array<{ type: string; data: unknown }> = [];
    const sseRes = {
      writeHead: vi.fn(),
      write: vi.fn((frame: string) => {
        events.push(parseSseFrame(frame));
        return true;
      }),
      on: vi.fn(),
    } as unknown as http.ServerResponse;
    const sseReq = {
      url: "/api/events?types=approval:update",
      headers: {},
      on: vi.fn(() => sseReq),
    } as unknown as http.IncomingMessage;
    sseBus.handleConnection(sseReq, sseRes, {}, { types: ["approval:update"] });

    const res = mockRes();
    await handleApprovalRoutes({
      ctx,
      req: mockJsonReq({}),
      res,
      url: new URL(`http://127.0.0.1/api/approvals/${encodeURIComponent(created.approvalId)}/approve`),
      pathname: `/api/approvals/${created.approvalId}/approve`,
      c: {},
    });
    expect(res.status).toBe(200);
    const update = events.find((e) => e.type === "approval:update");
    expect(update).toBeDefined();
    expect((update?.data as Record<string, unknown>)?.decision).toBe("approve");
  });

  it("returns 404 for unknown approval id", async () => {
    const res = mockRes();
    await handleApprovalRoutes({
      ctx,
      req: mockJsonReq({}),
      res,
      url: new URL("http://127.0.0.1/api/approvals/no-such-id/approve"),
      pathname: "/api/approvals/no-such-id/approve",
      c: {},
    });
    expect(res.status).toBe(404);
    expect((res.body as { code?: string }).code).toBe("approval_not_found");
  });
});

function parseSseFrame(frame: string): { type: string; data: unknown } {
  let type = "";
  const dataPieces: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataPieces.push(line.slice("data:".length).trimStart());
    }
  }
  const data = dataPieces.length ? JSON.parse(dataPieces.join("")) : null;
  return { type, data };
}

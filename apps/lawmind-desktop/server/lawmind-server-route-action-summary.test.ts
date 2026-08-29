import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { requestApproval } from "../../../src/lawmind/application/services/approval-service.js";
import { openQueueItem } from "../../../src/lawmind/application/services/queue-write-service.js";
import { saveAutomationInboxItem } from "../../../src/lawmind/platform/lawyer-automations.js";
import { handleActionSummaryRoutes } from "./lawmind-server-route-action-summary.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

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

describe("lawmind-server-route-action-summary", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-action-summary-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
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

  it("GET /api/action-summary returns aggregated counts", async () => {
    await fs.mkdir(path.join(workspaceDir, "drafts"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "drafts", "task-review.json"),
      JSON.stringify({
        taskId: "task-review",
        title: "待审意见书",
        output: "docx",
        templateId: "general",
        summary: "",
        sections: [],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: new Date().toISOString(),
      }),
    );
    const res = mockRes();
    const handled = await handleActionSummaryRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/action-summary"),
      pathname: "/api/action-summary",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      total: expect.any(Number),
      requiresDecisionTotal: 0,
      pendingReviewCount: 1,
      pendingReviewDrafts: [
        expect.objectContaining({ taskId: "task-review", title: "待审意见书" }),
      ],
      chatRequiresActions: expect.any(Array),
    });
  });

  it("requiresDecisionTotal matches fleet queue merge semantics (lawyer queue kinds + inbox dedupe)", async () => {
    // 待审文书（与 inbox 同 taskId 的那条应被去重）。
    await fs.mkdir(path.join(workspaceDir, "drafts"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "drafts", "task-dup.json"),
      JSON.stringify({
        taskId: "task-dup",
        title: "待审合同",
        output: "docx",
        templateId: "general",
        summary: "",
        sections: [],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: new Date().toISOString(),
      }),
    );
    // 律师拍板类队列项（计入）+ 助手侧队列项（不计入）。
    openQueueItem(workspaceDir, {
      matterId: "m1",
      kind: "need_lawyer_review",
      title: "待签批",
      relatedTaskId: "task-dup",
    });
    openQueueItem(workspaceDir, {
      matterId: "m1",
      kind: "ready_to_draft",
      title: "助手待起草",
    });
    // 同 draftTaskId 的交办 inbox（去重）+ 待发信 inbox（独立保留）。
    saveAutomationInboxItem(workspaceDir, {
      id: "inb-dup",
      automationId: "auto-1",
      matterId: "m1",
      title: "交办结果",
      summary: "完成",
      status: "open",
      draftTaskId: "task-dup",
      createdAt: new Date().toISOString(),
    });
    saveAutomationInboxItem(workspaceDir, {
      id: "inb-send",
      automationId: "auto-1",
      matterId: "m1",
      title: "待发信",
      summary: "完成",
      status: "open",
      pendingSend: { to: "client@x.com", subject: "审阅稿", body: "请查收" },
      createdAt: new Date().toISOString(),
    });

    const res = mockRes();
    const handled = await handleActionSummaryRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/action-summary"),
      pathname: "/api/action-summary",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    // 仅待发信计入待拍板；内部审稿 / 交办结果 / 队列审稿不计。
    expect((res.body as { requiresDecisionTotal?: number }).requiresDecisionTotal).toBe(1);
  });

  it("does not truncate automationInbox below the badge count (在办 list source)", async () => {
    const created = new Date().toISOString();
    for (let i = 0; i < 35; i += 1) {
      saveAutomationInboxItem(workspaceDir, {
        id: `inb-full-${i}`,
        automationId: "auto-1",
        matterId: "m1",
        title: `交办结果 ${i}`,
        summary: "完成",
        status: "open",
        createdAt: created,
      });
    }
    const res = mockRes();
    const handled = await handleActionSummaryRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/action-summary"),
      pathname: "/api/action-summary",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    const body = res.body as {
      requiresDecisionTotal?: number;
      pendingAutomationCount?: number;
      automationInbox?: unknown[];
    };
    expect(body.pendingAutomationCount).toBe(35);
    expect(body.automationInbox).toHaveLength(35);
    expect(body.requiresDecisionTotal).toBe(0);
  });

  it("GET /api/action-summary rejects invalid matterId", async () => {
    const res = mockRes();
    const handled = await handleActionSummaryRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/action-summary?matterId=../evil"),
      pathname: "/api/action-summary",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(400);
  });

  it("GET /api/action-summary exposes recent collab completions without inflating decisions", async () => {
    const { emitCollaborationEvent } = await import(
      "../../../src/lawmind/agent/collaboration/index.js"
    );
    const now = new Date().toISOString();
    emitCollaborationEvent(workspaceDir, {
      eventId: "ev-rev-1",
      kind: "review.completed",
      fromAssistantId: "a",
      toAssistantId: "b",
      matterId: "matter-alpha",
      timestamp: now,
    });
    emitCollaborationEvent(workspaceDir, {
      eventId: "ev-del-1",
      kind: "delegation.completed",
      fromAssistantId: "b",
      toAssistantId: "c",
      matterId: "matter-alpha",
      timestamp: now,
    });
    emitCollaborationEvent(workspaceDir, {
      eventId: "ev-other",
      kind: "delegation.completed",
      fromAssistantId: "x",
      toAssistantId: "y",
      matterId: "matter-beta",
      timestamp: now,
    });

    const resAll = mockRes();
    await handleActionSummaryRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: resAll,
      url: new URL("http://127.0.0.1/api/action-summary"),
      pathname: "/api/action-summary",
      c: {},
    });
    expect(resAll.body).toMatchObject({
      ok: true,
      requiresDecisionTotal: 0,
      recentReviewCompleted: 1,
      recentDelegationCompleted: 2,
      recentCollabCompleted: 3,
    });

    const resMatter = mockRes();
    await handleActionSummaryRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: resMatter,
      url: new URL("http://127.0.0.1/api/action-summary?matterId=matter-alpha"),
      pathname: "/api/action-summary",
      c: {},
    });
    // matter 过滤会合成策略缺失队列项；只断言协作角标口径，不要求 decision=0
    expect(resMatter.body).toMatchObject({
      ok: true,
      recentReviewCompleted: 1,
      recentDelegationCompleted: 1,
      recentCollabCompleted: 2,
    });
    const body = resMatter.body as {
      requiresDecisionTotal?: number;
      recentCollabCompleted?: number;
    };
    expect(body.requiresDecisionTotal ?? 0).toBeLessThan(
      (body.requiresDecisionTotal ?? 0) + (body.recentCollabCompleted ?? 0),
    );
  });

  it("POST /api/approvals/resolve: winner 200, CAS loser 409 approval_already_resolved", async () => {
    const created = requestApproval(workspaceDir, {
      matterId: "matter-appr-cas",
      requestedBy: "lawyer-1",
      reason: "并发签批",
      riskLevel: "high",
    });

    const winRes = mockRes();
    const winHandled = await handleActionSummaryRoutes({
      ctx,
      req: mockJsonReq({
        matterId: "matter-appr-cas",
        approvalId: created.approvalId,
        status: "approved",
        resolvedBy: "lawyer-a",
      }),
      res: winRes,
      url: new URL("http://127.0.0.1/api/approvals/resolve"),
      pathname: "/api/approvals/resolve",
      c: {},
    });
    expect(winHandled).toBe(true);
    expect(winRes.status).toBe(200);
    expect(winRes.body).toMatchObject({
      ok: true,
      approval: { status: "approved", resolvedBy: "lawyer-a" },
    });

    const loseRes = mockRes();
    const loseHandled = await handleActionSummaryRoutes({
      ctx,
      req: mockJsonReq({
        matterId: "matter-appr-cas",
        approvalId: created.approvalId,
        status: "rejected",
        resolvedBy: "lawyer-b",
      }),
      res: loseRes,
      url: new URL("http://127.0.0.1/api/approvals/resolve"),
      pathname: "/api/approvals/resolve",
      c: {},
    });
    expect(loseHandled).toBe(true);
    expect(loseRes.status).toBe(409);
    expect(loseRes.body).toMatchObject({
      ok: false,
      code: "approval_already_resolved",
      approval: { status: "approved", resolvedBy: "lawyer-a" },
    });
  });

  it("POST /api/approvals/resolve: missing approval → 404", async () => {
    requestApproval(workspaceDir, {
      matterId: "matter-appr-miss",
      requestedBy: "lawyer-1",
      reason: "x",
      riskLevel: "low",
    });
    const res = mockRes();
    await handleActionSummaryRoutes({
      ctx,
      req: mockJsonReq({
        matterId: "matter-appr-miss",
        approvalId: "does-not-exist",
        status: "approved",
      }),
      res,
      url: new URL("http://127.0.0.1/api/approvals/resolve"),
      pathname: "/api/approvals/resolve",
      c: {},
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, code: "approval_not_found" });
  });

  it("POST /api/approvals/resolve rejects invalid status", async () => {
    requestApproval(workspaceDir, {
      matterId: "matter-bad-status",
      requestedBy: "lawyer-1",
      reason: "x",
      riskLevel: "low",
    });
    const res = mockRes();
    await handleActionSummaryRoutes({
      ctx,
      req: mockJsonReq({
        matterId: "matter-bad-status",
        approvalId: "any",
        status: "maybe",
      }),
      res,
      url: new URL("http://127.0.0.1/api/approvals/resolve"),
      pathname: "/api/approvals/resolve",
      c: {},
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, code: "invalid_status" });
  });

  it("GET /api/action-summary rehydrates chat requiresAction from last turn", async () => {
    const { createSession, saveSession } = await import(
      "../../../src/lawmind/agent/session.js"
    );
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-chat-action",
    });
    session.turns.push({
      turnId: "turn-1",
      instruction: "请确认",
      result: "等待",
      requiresAction: [
        {
          actionId: "act-1",
          kind: "confirm",
          label: "确认导出",
          sessionId: session.sessionId,
        },
      ],
      messages: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    saveSession(workspaceDir, session);

    const res = mockRes();
    await handleActionSummaryRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/action-summary?matterId=matter-chat-action"),
      pathname: "/api/action-summary",
      c: {},
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      chatRequiresActionCount: 1,
      requiresDecisionTotal: expect.any(Number),
    });
    const body = res.body as { chatRequiresActions: Array<{ sessionId: string }> };
    expect(body.chatRequiresActions[0]?.sessionId).toBe(session.sessionId);
  });
});

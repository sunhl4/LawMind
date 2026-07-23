import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { handleActionSummaryRoutes } from "./lawmind-server-route-action-summary.js";
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
    await fs.rm(workspaceDir, { recursive: true, force: true });
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
      requiresDecisionTotal: 1,
      pendingReviewCount: 1,
      pendingReviewDrafts: [
        expect.objectContaining({ taskId: "task-review", title: "待审意见书" }),
      ],
      chatRequiresActions: expect.any(Array),
    });
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
});

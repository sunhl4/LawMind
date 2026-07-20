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
});

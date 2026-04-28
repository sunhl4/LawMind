import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft, readDraft } from "../../../src/lawmind/drafts/index.js";
import { ensureTaskRecord } from "../../../src/lawmind/tasks/index.js";
import type { ArtifactDraft, TaskIntent } from "../../../src/lawmind/types.js";
import { handleReviewRoute } from "./lawmind-server-route-review.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(nextStatus: number) {
      status = nextStatus;
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
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

function createJsonRequest(method: string, body?: unknown): http.IncomingMessage {
  const req = {
    method,
    headers: {},
  } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data" && body !== undefined) {
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

describe("lawmind-server-route-review", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("validates lawyer profile learning note", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const req = createJsonRequest("POST", { note: "" });
    const capture = createResponseCapture();

    await expect(
      handleReviewRoute({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/lawyer-profile/learning"),
        pathname: "/api/lawyer-profile/learning",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({ ok: false, error: "note required" });
  });

  it("rejects invalid assistant ids for assistant profile learning", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const req = createJsonRequest("POST", {
      assistantId: "../evil",
      note: "remember this",
    });
    const capture = createResponseCapture();

    await expect(
      handleReviewRoute({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/assistants/profile/learning"),
        pathname: "/api/assistants/profile/learning",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({ ok: false, error: "invalid assistant id" });
  });

  it("reviews then renders a contract draft through desktop routes", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-review-route-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer Profile\n", "utf8");

    const taskId = "contract-review-route-1";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "analyze.contract",
      output: "docx",
      summary: "合同审查",
      riskLevel: "medium",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "matter-contract-route",
      templateId: "word/contract-default",
    };
    ensureTaskRecord(workspaceDir, intent);

    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-contract-route",
      title: "合同审查意见书",
      output: "docx",
      templateId: "word/contract-default",
      summary: "已形成合同审查结论并提示主要风险。",
      sections: [
        {
          heading: "审查结论",
          body: "本合同可继续推进，但违约责任和解除条款建议进一步完善。",
          citations: ["src-1"],
        },
        {
          heading: "主要风险提示",
          body: "- 违约责任约定偏轻\n- 解除条款触发条件不够明确",
        },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    };
    persistDraft(workspaceDir, draft);

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };

    const reviewCapture = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: createJsonRequest("POST", { status: "approved", note: "可以导出正式稿" }),
        res: reviewCapture.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/review`),
        pathname: `/api/drafts/${taskId}/review`,
        c: {},
      }),
    ).resolves.toBe(true);

    expect(reviewCapture.status).toBe(200);
    expect(reviewCapture.json()).toMatchObject({
      ok: true,
      draft: { taskId, reviewStatus: "approved", templateId: "word/contract-default" },
    });

    const renderCapture = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: createJsonRequest("POST", {}),
        res: renderCapture.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/render`),
        pathname: `/api/drafts/${taskId}/render`,
        c: {},
      }),
    ).resolves.toBe(true);

    expect(renderCapture.status).toBe(200);
    const renderBody = renderCapture.json();
    expect(renderBody).toMatchObject({ ok: true });
    expect(String(renderBody.outputPath)).toMatch(/\.docx$/);
    expect(fs.existsSync(String(renderBody.outputPath))).toBe(true);
  });

  it("POST /api/drafts/:id/render applies templateId from JSON body", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-review-render-override-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer Profile\n", "utf8");

    const taskId = "override-template-task-1";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "analyze.contract",
      output: "docx",
      summary: "合同审查",
      riskLevel: "medium",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "m-override",
      templateId: "word/contract-default",
    };
    ensureTaskRecord(workspaceDir, intent);

    const draft: ArtifactDraft = {
      taskId,
      matterId: "m-override",
      title: "合同审查意见书",
      output: "docx",
      templateId: "word/contract-default",
      summary: "摘要",
      sections: [
        { heading: "审查结论", body: "结论正文", citations: ["src-1"] },
        { heading: "风险提示", body: "风险正文" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    };
    persistDraft(workspaceDir, draft);

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };

    const reviewCapture = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: createJsonRequest("POST", { status: "approved", note: "ok" }),
        res: reviewCapture.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/review`),
        pathname: `/api/drafts/${taskId}/review`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(reviewCapture.status).toBe(200);

    const renderCapture = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: createJsonRequest("POST", { templateId: "word/legal-memo-default" }),
        res: renderCapture.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/render`),
        pathname: `/api/drafts/${taskId}/render`,
        c: {},
      }),
    ).resolves.toBe(true);

    expect(renderCapture.status).toBe(200);
    const stored = readDraft(workspaceDir, taskId);
    expect(stored?.templateId).toBe("word/legal-memo-default");
  });

  it("reopen-review sets draft back to pending after modified", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-reopen-route-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    const taskId = "reopen-test-task-1";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "analyze.contract",
      output: "docx",
      summary: "合同",
      riskLevel: "low",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "m1",
      templateId: "word/contract-default",
    };
    ensureTaskRecord(workspaceDir, intent);
    const draft: ArtifactDraft = {
      taskId,
      matterId: "m1",
      title: "房屋租赁合同",
      output: "docx",
      templateId: "word/legal-memo-default",
      summary: "s",
      sections: [{ heading: "正文", body: "x" }],
      reviewNotes: [],
      reviewStatus: "modified",
      reviewedBy: "lawyer",
      reviewedAt: now,
      createdAt: now,
    };
    persistDraft(workspaceDir, draft);

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: createJsonRequest("POST", {}),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/reopen-review`),
        pathname: `/api/drafts/${taskId}/reopen-review`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json() as { ok: boolean; draft: ArtifactDraft; acceptance: unknown };
    expect(body.ok).toBe(true);
    expect(body.draft.reviewStatus).toBe("pending");
    expect(body.draft.reviewedBy).toBeUndefined();
    expect(body.acceptance).toBeDefined();
  });
});

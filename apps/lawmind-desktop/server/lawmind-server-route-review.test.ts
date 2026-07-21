import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft, readDraft } from "../../../src/lawmind/drafts/index.js";
import { ensureTaskRecord } from "../../../src/lawmind/tasks/index.js";
import { LAWMIND_MODEL_PROVIDERS } from "../../../src/lawmind/models/providers.js";
import type { ArtifactDraft, TaskIntent } from "../../../src/lawmind/types.js";
import { handleDraftRevisionJobRoute } from "./lawmind-server-route-draft-revision.js";
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

  it("GET /api/drafts/:id returns gateDecisions when draft omits summary", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-draft-no-summary-"));
    tempDirs.push(workspaceDir);
    const taskId = "draft-no-summary-1";
    const now = new Date().toISOString();
    const draft: ArtifactDraft = {
      taskId,
      title: "无摘要草稿",
      output: "docx",
      templateId: "word/legal-memo-default",
      sections: [{ heading: "正文", body: "E2E body" }],
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
    const cap = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: createJsonRequest("GET"),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}`),
        pathname: `/api/drafts/${taskId}`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json() as {
      ok: boolean;
      draft?: ArtifactDraft;
      gateDecisions?: Array<{ reason?: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.draft?.taskId).toBe(taskId);
    expect(Array.isArray(body.gateDecisions)).toBe(true);
    expect(body.gateDecisions?.some((g) => /等待律师签批/.test(g.reason ?? ""))).toBe(true);
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
        req: createJsonRequest("POST", {
          status: "approved",
          note: "可以导出正式稿",
          bypassChecklist: true,
        }),
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
      executionState: { phase: expect.any(String), status: expect.any(String) },
      gateDecisions: expect.any(Array),
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
    expect(renderBody).toMatchObject({
      executionState: { phase: expect.any(String), status: expect.any(String) },
      gateDecisions: expect.any(Array),
    });
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
        req: createJsonRequest("POST", { status: "approved", note: "ok", bypassChecklist: true }),
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
    expect(body).toMatchObject({
      executionState: { phase: "approval", status: "awaiting_approval" },
      gateDecisions: expect.any(Array),
    });
  });

  it("PATCH /api/drafts/:id/content saves editable draft body while pending", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-draft-content-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    const taskId = "draft-content-task-1";
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
      summary: "初稿摘要",
      sections: [{ heading: "正文", body: "原文" }],
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
    const cap = createResponseCapture();
    await expect(
      handleReviewRoute({
        ctx,
        req: createJsonRequest("PATCH", {
          title: "修订后的标题",
          summary: "更新摘要",
          sections: [{ heading: "正文", body: "律师已直接修改正文" }],
        }),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/content`),
        pathname: `/api/drafts/${taskId}/content`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json() as { ok: boolean; draft: ArtifactDraft; acceptance: unknown };
    expect(body.ok).toBe(true);
    expect(body.draft.title).toBe("修订后的标题");
    expect(body.draft.sections[0]?.body).toBe("律师已直接修改正文");
    const stored = readDraft(workspaceDir, taskId);
    expect(stored?.summary).toBe("更新摘要");
    expect(body.acceptance).toBeDefined();
  });

  it("PATCH /api/drafts/:id/content rejects approved drafts", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-draft-content-ro-"));
    tempDirs.push(workspaceDir);
    const taskId = "draft-content-ro-1";
    const now = new Date().toISOString();
    persistDraft(workspaceDir, {
      taskId,
      title: "已通过",
      output: "docx",
      templateId: "word/legal-memo-default",
      summary: "s",
      sections: [{ heading: "正文", body: "x" }],
      reviewNotes: [],
      reviewStatus: "approved",
      createdAt: now,
    });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await handleReviewRoute({
      ctx,
      req: createJsonRequest("PATCH", { summary: "不应保存" }),
      res: cap.res,
      url: new URL(`http://127.0.0.1/api/drafts/${taskId}/content`),
      pathname: `/api/drafts/${taskId}/content`,
      c: {},
    });
    expect(cap.status).toBe(409);
    expect((cap.json() as { error?: string }).error).toBe("draft_not_editable");
  });

  it("on approve, persists contract revision accumulation when draft has contractRevisionCapture", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-contract-rev-acc-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer Profile\n", "utf8");
    fs.mkdirSync(path.join(workspaceDir, "batch"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "batch", "initial.txt"), "v1\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "batch", "revised.txt"), "v2\n", "utf8");

    const taskId = "contract-rev-capture-task-1";
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
      title: "某合同修订",
      output: "docx",
      templateId: "word/contract-default",
      summary: "摘要",
      sections: [{ heading: "正文", body: "x", citations: ["src-1"] }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      contractRevisionCapture: {
        initialRelativePath: "batch/initial.txt",
        revisedRelativePath: "batch/revised.txt",
        stableDocumentKey: "LEASE-DEMO-001",
        keyModifications: ["违约责任加重"],
      },
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
        req: createJsonRequest("POST", {
          status: "approved",
          note: "同意定稿",
          bypassChecklist: true,
        }),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/review`),
        pathname: `/api/drafts/${taskId}/review`,
        c: {},
      }),
    ).resolves.toBe(true);

    expect(cap.status).toBe(200);
    const body = cap.json() as {
      ok: boolean;
      draft: ArtifactDraft;
      contractRevisionAccumulatedId?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.contractRevisionAccumulatedId).toMatch(/^cr_\d{8}_[a-f0-9]+$/);
    expect(body.draft.contractRevisionAccumulatedId).toBe(body.contractRevisionAccumulatedId);
    expect(body.draft.contractRevisionCapture).toBeUndefined();

    const reread = readDraft(workspaceDir, taskId);
    expect(reread?.contractRevisionAccumulatedId).toBe(body.contractRevisionAccumulatedId);
    expect(reread?.contractRevisionCapture).toBeUndefined();

    const revId = body.contractRevisionAccumulatedId!;
    const packDir = path.join(workspaceDir, "learning", "contract-revisions", revId);
    expect(fs.existsSync(path.join(packDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(packDir, "KEY_MODIFICATIONS.md"))).toBe(true);
    const idx = path.join(
      workspaceDir,
      "learning",
      "contract-revisions",
      "_index",
      "by-key",
      "LEASE-DEMO-001.json",
    );
    expect(fs.existsSync(idx)).toBe(true);
  });

  it("revision-job rejects when draft is still pending", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-revision-job-pending-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    const taskId = "revision-job-pending-1";
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
    const cap = createResponseCapture();
    await expect(
      handleDraftRevisionJobRoute({
        ctx,
        req: createJsonRequest("POST", { instruction: "改第一段" }),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/revision-job`),
        pathname: `/api/drafts/${taskId}/revision-job`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(400);
    const body = cap.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("revision_job_requires_modified");
  });

  it("revision-job returns 503 when model API key is missing", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-revision-job-nokey-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    const taskId = "revision-job-nokey-1";
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
      reviewNotes: ["请软化语气"],
      reviewStatus: "modified",
      reviewedBy: "lawyer",
      reviewedAt: now,
      createdAt: now,
    };
    persistDraft(workspaceDir, draft);

    const envPath = path.join(workspaceDir, ".env.lawmind");
    fs.writeFileSync(envPath, "", "utf8");
    fs.writeFileSync(
      path.join(workspaceDir, "assistants.json"),
      JSON.stringify([
        {
          assistantId: "default",
          displayName: "默认助手",
          introduction: "测试",
          createdAt: now,
          updatedAt: now,
        },
      ]),
      "utf8",
    );

    const PLATFORM_INFERENCE_KEYS = [
      "LAWMIND_PLATFORM_ACCESS_TOKEN",
      "LAWMIND_PLATFORM_API_TOKEN",
      "LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY",
      "LAWMIND_PLATFORM_QWEN_API_KEY",
      "LAWMIND_PLATFORM_PROVIDER_OPENAI_API_KEY",
      "LAWMIND_PLATFORM_PROVIDER_DEEPSEEK_API_KEY",
      "LAWMIND_PLATFORM_PROVIDER_MOONSHOT_API_KEY",
      "LAWMIND_PLATFORM_PROVIDER_ZHIPU_API_KEY",
    ];
    const keys = [
      ...new Set<string>([...LAWMIND_MODEL_PROVIDERS.flatMap((p) => p.apiKeyEnvKeys), ...PLATFORM_INFERENCE_KEYS]),
    ];
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const ctx: LawmindDispatchContext = {
        workspaceDir,
        envFile: envPath,
        userEnvPath: envPath,
        policy: { loaded: false },
      };
      const cap = createResponseCapture();
      await expect(
        handleDraftRevisionJobRoute({
          ctx,
          req: createJsonRequest("POST", { instruction: "补充违约责任" }),
          res: cap.res,
          url: new URL(`http://127.0.0.1/api/drafts/${taskId}/revision-job`),
          pathname: `/api/drafts/${taskId}/revision-job`,
          c: {},
        }),
      ).resolves.toBe(true);
      expect(cap.status).toBe(503);
      const body = cap.json() as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("missing_api_key");
    } finally {
      for (const k of keys) {
        if (prev[k] !== undefined) {
          process.env[k] = prev[k];
        } else {
          delete process.env[k];
        }
      }
    }
  });

  it("POST /api/drafts/:id/render returns 422 when strict acceptance gate blocks", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-review-strict-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer Profile\n", "utf8");

    const taskId = "strict-blocked-task";
    const now = new Date().toISOString();
    ensureTaskRecord(workspaceDir, {
      taskId,
      kind: "analyze.contract",
      output: "docx",
      summary: "合同",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "m-strict",
    } as TaskIntent);

    persistDraft(workspaceDir, {
      taskId,
      matterId: "m-strict",
      title: "不完整草稿",
      output: "docx",
      templateId: "contract-rental-default",
      deliverableType: "contract.rental",
      summary: "摘要",
      sections: [{ heading: "一、合同主体", body: "仅有一节，缺其余章节。", citations: [] }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    } as ArtifactDraft);

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
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/render`),
        pathname: `/api/drafts/${taskId}/render`,
        c: {},
      }),
    ).resolves.toBe(true);

    expect(cap.status).toBe(422);
    expect(cap.json()).toMatchObject({
      ok: false,
      error: "acceptance_gate_blocked",
    });
  });

  it("POST /api/drafts/:id/review returns 422 when checklist incomplete", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-review-checklist-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");

    const taskId = "checklist-gate-1";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "analyze.contract",
      output: "docx",
      summary: "催告",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
    };
    ensureTaskRecord(workspaceDir, intent);
    persistDraft(workspaceDir, {
      taskId,
      title: "催告函",
      output: "docx",
      summary: "催告摘要",
      deliverableType: "letter.demand",
      sections: [{ heading: "正文", body: "请于限期履行。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    } as ArtifactDraft);

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
        req: createJsonRequest("POST", { status: "approved", note: "未勾选清单" }),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/review`),
        pathname: `/api/drafts/${taskId}/review`,
        c: {},
      }),
    ).resolves.toBe(true);

    expect(cap.status).toBe(422);
    expect(cap.json()).toMatchObject({
      ok: false,
      error: "checklist_incomplete",
    });
  });
});

import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearExtraDeliverableSpecs,
  registerExtraDeliverableSpecs,
} from "../../../src/lawmind/deliverables/index.js";
import { persistDraft } from "../../../src/lawmind/drafts/index.js";
import { ensureTaskRecord } from "../../../src/lawmind/tasks/index.js";
import type { ArtifactDraft, TaskIntent } from "../../../src/lawmind/types.js";
import { handleAcceptanceRoutes } from "./lawmind-server-route-acceptance.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(value: number) {
      status = value;
    },
    get statusCode(): number {
      return status;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
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
    text() {
      return body;
    },
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

function emptyReq(method = "GET", url = "/"): http.IncomingMessage {
  return { method, headers: {}, url } as http.IncomingMessage;
}

describe("lawmind-server-route-acceptance", () => {
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
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq(),
        res: createResponseCapture().res,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("lists built-in deliverable specs and labels their source", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq(),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/deliverables/specs"),
        pathname: "/api/deliverables/specs",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json() as { ok: boolean; specs: Array<{ type: string; source: string }> };
    expect(body.ok).toBe(true);
    const types = body.specs.map((s) => s.type);
    expect(types).toContain("contract.rental");
    expect(types).toContain("letter.demand");
    // 不带任何工作区 extras 时所有 spec 应当都是 builtin
    for (const s of body.specs) {
      expect(s.source).toBe("builtin");
    }
  });

  it("labels workspace-registered specs as source=workspace", async () => {
    try {
      registerExtraDeliverableSpecs([
        {
          type: "contract.special-leasehold-firm-x",
          displayName: "Firm X 专属租赁",
          description: "工作区自定义合同",
          defaultTemplateId: "word/contract.rental.default",
          defaultOutput: "word",
          defaultRiskLevel: "medium",
          requiredSections: [
            { id: "header", title: "头部", severity: "blocker" },
          ],
          acceptanceCriteria: ["双方签章齐全"],
          placeholderRule: { pattern: /\{\{[^}]+\}\}/g, mustResolveBeforeRender: true },
          defaultClarificationQuestions: [],
        },
      ]);
      const ctx: LawmindDispatchContext = {
        workspaceDir: os.tmpdir(),
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const cap = createResponseCapture();
      await handleAcceptanceRoutes({
        ctx,
        req: emptyReq(),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/deliverables/specs"),
        pathname: "/api/deliverables/specs",
        c: {},
      });
      expect(cap.status).toBe(200);
      const body = cap.json() as {
        ok: boolean;
        specs: Array<{ type: string; source: string }>;
      };
      const custom = body.specs.find((s) => s.type === "contract.special-leasehold-firm-x");
      expect(custom).toBeTruthy();
      expect(custom?.source).toBe("workspace");
    } finally {
      clearExtraDeliverableSpecs();
    }
  });

  it("returns the resolved edition (defaults to solo)", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq(),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/policy/edition"),
        pathname: "/api/policy/edition",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    expect(cap.json()).toMatchObject({ ok: true, edition: "solo" });
  });

  it("returns 400 for an unsafe task id on /acceptance", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq(),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/drafts/..%2Fevil/acceptance"),
        pathname: "/api/drafts/..%2Fevil/acceptance",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(400);
  });

  it("returns 404 when the draft does not exist", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-acceptance-route-"));
    tempDirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq(),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/drafts/missing-task/acceptance"),
        pathname: "/api/drafts/missing-task/acceptance",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(404);
  });

  it("returns acceptance report for an existing draft", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-acceptance-route-"));
    tempDirs.push(workspaceDir);

    const taskId = "rental-acceptance-1";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "draft.word",
      output: "docx",
      instruction: "起草租赁合同",
      summary: "起草租赁合同",
      riskLevel: "medium",
      models: ["legal"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "matter-acceptance",
      templateId: "word/contract-rental",
      deliverableType: "contract.rental",
    };
    ensureTaskRecord(workspaceDir, intent);

    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-acceptance",
      title: "房屋租赁合同（草拟稿）",
      output: "docx",
      templateId: "word/contract-rental",
      summary: "已生成租赁合同骨架，待补充关键要素。",
      sections: [
        {
          heading: "合同当事人",
          body: "出租人：【待补充:出租方姓名】\n承租人：【待补充:承租方姓名】",
        },
        { heading: "租赁标的", body: "房屋坐落：【待补充:房屋详细地址】" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      deliverableType: "contract.rental",
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
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq(),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/acceptance`),
        pathname: `/api/drafts/${taskId}/acceptance`,
        c: {},
      }),
    ).resolves.toBe(true);

    expect(cap.status).toBe(200);
    const body = cap.json() as {
      ok: boolean;
      acceptance: { ready: boolean; placeholderCount: number };
      spec?: { type: string; displayName: string };
    };
    expect(body.ok).toBe(true);
    expect(body.acceptance.placeholderCount).toBeGreaterThan(0);
    expect(body.acceptance.ready).toBe(false);
    expect(body.spec?.type).toBe("contract.rental");
  });

  it("blocks acceptance-pack on Solo edition (default) with 403", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pack-route-"));
    tempDirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    const taskId = "task-pack-403";
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq("GET", `/api/drafts/${taskId}/acceptance-pack`),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/acceptance-pack`),
        pathname: `/api/drafts/${taskId}/acceptance-pack`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(403);
    expect(cap.json()).toMatchObject({ ok: false, feature: "acceptancePackExport" });
  });

  it("returns markdown body for Firm edition draft acceptance-pack", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pack-route-"));
    tempDirs.push(workspaceDir);
    const taskId = "rental-pack-1";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "draft.word",
      output: "docx",
      instruction: "起草租赁合同",
      summary: "起草租赁合同",
      riskLevel: "medium",
      models: ["legal"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "matter-pack",
      templateId: "word/contract-rental",
      deliverableType: "contract.rental",
    };
    ensureTaskRecord(workspaceDir, intent);
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-pack",
      title: "房屋租赁合同（验收包测试）",
      output: "docx",
      templateId: "word/contract-rental",
      summary: "测试用草稿",
      sections: [
        {
          heading: "合同当事人",
          body: "出租人：【待补充：出租方姓名】\n承租人：【待补充：承租方姓名】",
        },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      deliverableType: "contract.rental",
    };
    persistDraft(workspaceDir, draft);

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: {
        loaded: true,
        path: path.join(workspaceDir, "lawmind.policy.json"),
        policy: { schemaVersion: 1, edition: "firm" } as never,
        applied: [],
      },
    };
    const cap = createResponseCapture();
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq("GET", `/api/drafts/${taskId}/acceptance-pack`),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/acceptance-pack`),
        pathname: `/api/drafts/${taskId}/acceptance-pack`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    expect(cap.header("content-type")).toContain("text/markdown");
    expect(cap.header("content-disposition")).toContain(taskId);
    expect(cap.text()).toContain("LawMind 交付验收包");
    expect(cap.text()).toContain(taskId);
  });

  it("returns markdown wrapped in JSON when format=json", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pack-route-"));
    tempDirs.push(workspaceDir);
    const taskId = "rental-pack-json";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "draft.word",
      output: "docx",
      instruction: "起草租赁合同 json",
      summary: "起草租赁合同 json",
      riskLevel: "medium",
      models: ["legal"],
      requiresConfirmation: false,
      createdAt: now,
      templateId: "word/contract-rental",
      deliverableType: "contract.rental",
    };
    ensureTaskRecord(workspaceDir, intent);
    const draft: ArtifactDraft = {
      taskId,
      title: "房屋租赁合同 (json mode)",
      output: "docx",
      templateId: "word/contract-rental",
      summary: "测试用",
      sections: [{ heading: "合同主体", body: "出租人：A 承租人：B" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      deliverableType: "contract.rental",
    };
    persistDraft(workspaceDir, draft);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: {
        loaded: true,
        path: path.join(workspaceDir, "lawmind.policy.json"),
        policy: { schemaVersion: 1, edition: "private_deploy" } as never,
        applied: [],
      },
    };
    const cap = createResponseCapture();
    await expect(
      handleAcceptanceRoutes({
        ctx,
        req: emptyReq("GET", `/api/drafts/${taskId}/acceptance-pack?format=json`),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/acceptance-pack?format=json`),
        pathname: `/api/drafts/${taskId}/acceptance-pack`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json() as { ok: boolean; markdown: string };
    expect(body.ok).toBe(true);
    expect(body.markdown).toContain("LawMind 交付验收包");
  });
});

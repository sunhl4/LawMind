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
import { validateDraftAgainstSpec } from "../../../src/lawmind/deliverables/index.js";
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

  it("GET /api/policy/edition ignores policy.features overrides", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-edition-feat-"));
    fs.writeFileSync(
      path.join(workspaceDir, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "solo",
        features: { complianceAuditExport: true, acceptanceGateStrict: false },
      }),
      "utf8",
    );
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env"),
      policy: {
        loaded: true,
        path: path.join(workspaceDir, "lawmind.policy.json"),
        applied: [],
        policy: {
          schemaVersion: 1,
          edition: "solo",
          features: { complianceAuditExport: true, acceptanceGateStrict: false },
        },
      },
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
    const body = cap.json() as {
      features?: { complianceAuditExport?: boolean; acceptanceGateStrict?: boolean };
    };
    expect(body.features?.complianceAuditExport).toBe(false);
    expect(body.features?.acceptanceGateStrict).toBe(true);
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

  /**
   * `/api/acceptance-summary` 的 blocker / warning 计数。
   *
   * 这一条锁的是一个**静默错数**（律师可见）：路由此前读的是 `check.ok`，
   * 而 `AcceptanceCheck` 的字段叫 `passed` —— `!c.ok` 永远为真，
   * 于是**已通过的 blocker 也被计进「未通过」**，接受度概览整体报高。
   *
   * 断言方式刻意不是「等于某个硬编码数字」，而是**用同一个领域函数独立重算**并比较：
   * 这才是这个字段的定义（路由只负责搬运），也正是出错的那一步。
   */
  it("/api/acceptance-summary 的 blockerCount 只数**未通过**的 blocker（已通过的不计）", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-acc-summary-"));
    tempDirs.push(workspaceDir);

    const taskId = "rental-summary-1";
    const now = new Date().toISOString();
    ensureTaskRecord(workspaceDir, {
      taskId,
      kind: "draft.word",
      output: "docx",
      instruction: "起草租赁合同",
      summary: "起草租赁合同",
      riskLevel: "medium",
      models: ["legal"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "matter-summary",
      templateId: "word/contract-rental",
      deliverableType: "contract.rental",
    } as TaskIntent);

    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-summary",
      title: "房屋租赁合同（草拟稿）",
      output: "docx",
      templateId: "word/contract-rental",
      summary: "已生成租赁合同骨架，待补充关键要素。",
      sections: [
        { heading: "合同当事人", body: "出租人：张某\n承租人：李某" },
        { heading: "租赁标的", body: "房屋坐落：某市某区某路 1 号" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      deliverableType: "contract.rental",
    };
    persistDraft(workspaceDir, draft);

    // 用领域函数独立重算「真值」，再与路由给的对齐。
    const truth = validateDraftAgainstSpec(draft);
    const failedBlockers = truth.checks.filter((c) => c.severity === "blocker" && !c.passed).length;
    const failedWarnings = truth.checks.filter((c) => c.severity === "warning" && !c.passed).length;
    const passedBlockers = truth.checks.filter((c) => c.severity === "blocker" && c.passed).length;

    const cap = createResponseCapture();
    await handleAcceptanceRoutes({
      ctx: {
        workspaceDir,
        envFile: undefined,
        userEnvPath: path.join(workspaceDir, ".env.lawmind"),
        policy: { loaded: false },
      },
      req: emptyReq(),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/acceptance-summary"),
      pathname: "/api/acceptance-summary",
      c: {},
    });

    expect(cap.status).toBe(200);
    const body = cap.json() as {
      items: Array<{ taskId: string; blockerCount: number; warningCount: number; ready: boolean }>;
    };
    const row = body.items.find((i) => i.taskId === taskId);
    expect(row).toBeTruthy();
    expect(row?.blockerCount).toBe(failedBlockers);
    expect(row?.warningCount).toBe(failedWarnings);

    // 决定性的一半：本夹具必须存在**已通过**的 blocker，
    // 否则「已通过的不计」这条根本没被验证（旧实现也会碰巧通过）。
    expect(
      passedBlockers,
      "夹具退化：本件没有任何已通过的 blocker，这组断言就失去了意义",
    ).toBeGreaterThan(0);
    expect(row?.blockerCount).toBeLessThan(failedBlockers + passedBlockers);
  });

  it("allows acceptance-pack on Solo edition (default) when draft exists", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pack-route-"));
    tempDirs.push(workspaceDir);
    const taskId = "solo-pack-1";
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
      matterId: "matter-solo-pack",
      templateId: "word/contract-rental",
      deliverableType: "contract.rental",
    };
    ensureTaskRecord(workspaceDir, intent);
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-solo-pack",
      title: "房屋租赁合同（Solo 验收包）",
      output: "docx",
      templateId: "word/contract-rental",
      summary: "测试用草稿",
      sections: [{ heading: "合同当事人", body: "出租人：甲\n承租人：乙" }],
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
        req: emptyReq("GET", `/api/drafts/${taskId}/acceptance-pack`),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/drafts/${taskId}/acceptance-pack`),
        pathname: `/api/drafts/${taskId}/acceptance-pack`,
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    expect(cap.header("content-type")).toContain("text/markdown");
    expect(cap.text()).toContain("LawMind 交付验收包");
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

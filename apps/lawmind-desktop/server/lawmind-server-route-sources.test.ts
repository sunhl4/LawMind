import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "../../../src/lawmind/drafts/index.js";
import { persistResearchSnapshot } from "../../../src/lawmind/drafts/research-snapshot.js";
import type {
  ArtifactDraft,
  ResearchBundle,
} from "../../../src/lawmind/types.js";
import { handleSourceRoutes } from "./lawmind-server-route-sources.js";
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
  };
}

function emptyReq(method = "GET", url = "/"): http.IncomingMessage {
  return { method, headers: {}, url } as http.IncomingMessage;
}

function makeBundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "测试查询",
    sources: [
      {
        id: "s-001",
        title: "民法典 第七百零三条",
        kind: "statute",
        citation: "《民法典》第七百零三条",
        url: "https://flk.npc.gov.cn/example",
        date: "2021-01-01",
      },
      {
        id: "s-002",
        title: "最高法（2020）民终123号",
        kind: "case",
        citation: "(2020)最高法民终123号",
        court: "最高人民法院",
        caseNumber: "(2020)最高法民终123号",
      },
    ],
    claims: [
      {
        text: "租赁合同应当采用书面形式",
        sourceIds: ["s-001"],
        confidence: 0.92,
        model: "legal",
      },
      {
        text: "口头约定在某些情形下也可成立",
        sourceIds: ["s-001", "s-002"],
        confidence: 0.7,
        model: "legal",
      },
    ],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("lawmind-server-route-sources", () => {
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
      handleSourceRoutes({
        ctx,
        req: emptyReq(),
        res: createResponseCapture().res,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("returns 400 for path-traversal source ids", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-source-route-"));
    tempDirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleSourceRoutes({
        ctx,
        req: emptyReq("GET", "/api/sources/..%2Fevil/preview"),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/sources/..%2Fevil/preview"),
        pathname: "/api/sources/..%2Fevil/preview",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(400);
  });

  it("returns 404 when the research snapshot is missing for the task", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-source-route-"));
    tempDirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleSourceRoutes({
        ctx,
        req: emptyReq("GET", "/api/sources/s-001/preview?taskId=missing"),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/sources/s-001/preview?taskId=missing"),
        pathname: "/api/sources/s-001/preview",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(404);
    expect(cap.json().error).toBe("research_snapshot_not_found");
  });

  it("returns the source detail + supporting claims + sectionsCiting", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-source-route-"));
    tempDirs.push(workspaceDir);

    const taskId = "src-task-1";
    persistResearchSnapshot(workspaceDir, makeBundle(taskId));

    const draft: ArtifactDraft = {
      taskId,
      title: "示例草稿",
      output: "markdown",
      templateId: "demo",
      summary: "示例摘要",
      sections: [
        { heading: "结论", body: "见来源", citations: ["s-001"] },
        { heading: "类案", body: "见来源", citations: ["s-002"] },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
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
      handleSourceRoutes({
        ctx,
        req: emptyReq("GET", `/api/sources/s-001/preview?taskId=${taskId}`),
        res: cap.res,
        url: new URL(`http://127.0.0.1/api/sources/s-001/preview?taskId=${taskId}`),
        pathname: "/api/sources/s-001/preview",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(cap.status).toBe(200);
    const body = cap.json() as {
      ok: boolean;
      source: { id: string; title: string; citation?: string };
      supportingClaims: Array<{ text: string }>;
      sectionsCiting: Array<{ heading: string }>;
      taskId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.source.id).toBe("s-001");
    expect(body.source.citation).toBe("《民法典》第七百零三条");
    expect(body.supportingClaims.length).toBe(2);
    expect(body.sectionsCiting).toEqual([{ heading: "结论" }]);
    expect(body.taskId).toBe(taskId);
  });

  it("scans the workspace when no taskId is supplied", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-source-route-"));
    tempDirs.push(workspaceDir);

    persistResearchSnapshot(workspaceDir, makeBundle("scan-task-a"));
    persistResearchSnapshot(workspaceDir, makeBundle("scan-task-b"));

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleSourceRoutes({
        ctx,
        req: emptyReq("GET", "/api/sources/s-002/preview"),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/sources/s-002/preview"),
        pathname: "/api/sources/s-002/preview",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json() as { ok: boolean; source: { id: string }; taskId: string };
    expect(body.ok).toBe(true);
    expect(body.source.id).toBe("s-002");
    expect(["scan-task-a", "scan-task-b"]).toContain(body.taskId);
  });

  it("returns 404 when the source id is unknown", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-source-route-"));
    tempDirs.push(workspaceDir);
    persistResearchSnapshot(workspaceDir, makeBundle("only-task"));

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleSourceRoutes({
        ctx,
        req: emptyReq("GET", "/api/sources/s-999/preview?taskId=only-task"),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/sources/s-999/preview?taskId=only-task"),
        pathname: "/api/sources/s-999/preview",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(404);
    expect(cap.json().error).toBe("source_not_found");
  });

  it("ignores non-GET methods", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    await expect(
      handleSourceRoutes({
        ctx,
        req: emptyReq("POST", "/api/sources/s-001/preview"),
        res: createResponseCapture().res,
        url: new URL("http://127.0.0.1/api/sources/s-001/preview"),
        pathname: "/api/sources/s-001/preview",
        c: {},
      }),
    ).resolves.toBe(false);
  });
});

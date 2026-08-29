import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { persistDraft } from "../../../src/lawmind/drafts/index.js";
import { writeRedlineProposal } from "../../../src/lawmind/drafts/redline-proposal.js";
import { readStanceItems } from "../../../src/lawmind/stance/index.js";
import { handleRedlineRoutes } from "./lawmind-server-route-redline.js";
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

describe("lawmind-server-route-redline", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fsPromises.mkdtemp(path.join("/tmp", "lawmind-redline-"));
    await fsPromises.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fsPromises.rm(workspaceDir, { recursive: true, force: true });
  });

  it("GET /api/drafts/:id/redline returns empty proposal when none saved", async () => {
    const res = mockRes();
    const handled = await handleRedlineRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/drafts/task-redline-1/redline"),
      pathname: "/api/drafts/task-redline-1/redline",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, proposal: null });
  });

  it("GET /api/drafts/:id/redline returns 400 for unsafe task id", async () => {
    const res = mockRes();
    const handled = await handleRedlineRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/drafts/task%20space/redline"),
      pathname: "/api/drafts/task space/redline",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(400);
  });

  it("captures stance after accepting a 管辖 hunk", async () => {
    persistDraft(workspaceDir, {
      taskId: "task-stance-1",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [{ heading: "争议解决", body: "提交北京仲裁委员会仲裁" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });
    writeRedlineProposal(workspaceDir, {
      taskId: "task-stance-1",
      baselineSections: [{ heading: "争议解决", body: "由甲方所在地人民法院管辖" }],
      hunks: [
        {
          hunkId: "h-jurisdiction",
          sectionIndex: 0,
          sectionHeading: "争议解决",
          before: "由甲方所在地人民法院管辖",
          after: "提交北京仲裁委员会仲裁",
          status: "pending",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    const res = mockRes();
    const handled = await handleRedlineRoutes({
      ctx,
      req: mockJsonReq({ decision: "accept" }),
      res,
      url: new URL("http://127.0.0.1/api/drafts/task-stance-1/redline/hunks/h-jurisdiction/resolve"),
      pathname: "/api/drafts/task-stance-1/redline/hunks/h-jurisdiction/resolve",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean })?.ok).toBe(true);
    const items = readStanceItems(workspaceDir);
    expect(items.some((it) => it.clauseType === "管辖" && it.preferredLanguage.includes("北京仲裁委员会"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(workspaceDir, "lawmind", "stance", "items.json"))).toBe(true);
  });
});

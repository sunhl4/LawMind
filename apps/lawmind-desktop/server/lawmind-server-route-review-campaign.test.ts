import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "../../../src/lawmind/drafts/index.js";
import type { ArtifactDraft } from "../../../src/lawmind/types.js";
import { handleReviewCampaignRoutes } from "./lawmind-server-route-review-campaign.js";
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
  const req = { method, headers: {} } as http.IncomingMessage;
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

describe("lawmind-server-route-review-campaign", () => {
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
      handleReviewCampaignRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: {} as http.ServerResponse,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("lists playbooks, creates campaign, reruns role, returns report", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-campaign-route-"));
    tempDirs.push(workspaceDir);
    fs.mkdirSync(path.join(workspaceDir, "matters", "m1"), { recursive: true });
    const taskId = "camp-task-1";
    persistDraft(workspaceDir, {
      taskId,
      matterId: "m1",
      title: "合同审查",
      output: "docx",
      summary: "无责任上限。个人信息处理。自动续期。",
      deliverableType: "contract.review",
      sections: [
        {
          heading: "风险",
          body: "对方要求无限责任，且无责任上限条款。",
        },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    } as ArtifactDraft);

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };

    const listCap = createResponseCapture();
    await expect(
      handleReviewCampaignRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: listCap.res,
        url: new URL("http://127.0.0.1/api/fleet-playbooks"),
        pathname: "/api/fleet-playbooks",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(listCap.status).toBe(200);
    expect((listCap.json() as { playbooks: unknown[] }).playbooks.length).toBeGreaterThan(0);

    const createCap = createResponseCapture();
    await expect(
      handleReviewCampaignRoutes({
        ctx,
        req: createJsonRequest("POST", {
          matterId: "m1",
          taskId,
          playbookId: "standard-contract-review",
          idempotencyKey: "campaign:camp-task-1:v1",
          runNow: true,
        }),
        res: createCap.res,
        url: new URL("http://127.0.0.1/api/review-campaigns"),
        pathname: "/api/review-campaigns",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(createCap.status).toBe(200);
    const created = createCap.json() as {
      ok: boolean;
      campaign: { id: string; status: string; roles: unknown[]; safetyScore: { score: number } };
    };
    expect(created.ok).toBe(true);
    expect(created.campaign.status).toBe("completed");
    expect(created.campaign.roles.length).toBeGreaterThanOrEqual(4);
    expect(created.campaign.safetyScore.score).toBeTypeOf("number");

    const again = createResponseCapture();
    await handleReviewCampaignRoutes({
      ctx,
      req: createJsonRequest("POST", {
        matterId: "m1",
        taskId,
        idempotencyKey: "campaign:camp-task-1:v1",
        runNow: true,
      }),
      res: again.res,
      url: new URL("http://127.0.0.1/api/review-campaigns"),
      pathname: "/api/review-campaigns",
      c: {},
    });
    expect((again.json() as { campaign: { id: string } }).campaign.id).toBe(created.campaign.id);

    const rerunCap = createResponseCapture();
    await handleReviewCampaignRoutes({
      ctx,
      req: createJsonRequest("POST", {}),
      res: rerunCap.res,
      url: new URL(
        `http://127.0.0.1/api/review-campaigns/${created.campaign.id}/roles/risk/rerun`,
      ),
      pathname: `/api/review-campaigns/${created.campaign.id}/roles/risk/rerun`,
      c: {},
    });
    expect(rerunCap.status).toBe(200);

    const reportCap = createResponseCapture();
    await handleReviewCampaignRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: reportCap.res,
      url: new URL(`http://127.0.0.1/api/review-campaigns/${created.campaign.id}/report`),
      pathname: `/api/review-campaigns/${created.campaign.id}/report`,
      c: {},
    });
    expect(reportCap.status).toBe(200);
    expect((reportCap.json() as { markdown: string }).markdown).toContain("Safety Score");
  });
});

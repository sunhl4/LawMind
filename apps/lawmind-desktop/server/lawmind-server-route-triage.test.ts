import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleTriageRoutes } from "./lawmind-server-route-triage.js";
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

describe("lawmind-server-route-triage", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET /api/triage/rules lists rule ids", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    await expect(
      handleTriageRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: cap.res,
        url: new URL("http://127.0.0.1/api/triage/rules"),
        pathname: "/api/triage/rules",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json() as { ok: boolean; ruleIds: string[] };
    expect(body.ok).toBe(true);
    expect(body.ruleIds.length).toBeGreaterThan(0);
  });

  it("POST /api/triage preview then confirm", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-triage-route-"));
    tempDirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };

    const preview = createResponseCapture();
    await expect(
      handleTriageRoutes({
        ctx,
        req: createJsonRequest("POST", {
          text: "请审查双方 NDA，关注保密期限。",
          deliverableTypeHint: "contract.nda",
        }),
        res: preview.res,
        url: new URL("http://127.0.0.1/api/triage"),
        pathname: "/api/triage",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(preview.status).toBe(200);
    const previewBody = preview.json() as {
      ok: boolean;
      session: { id: string; result: { tier: string } };
    };
    expect(previewBody.ok).toBe(true);
    expect(previewBody.session.result.tier).toBe("yellow");

    const confirm = createResponseCapture();
    await expect(
      handleTriageRoutes({
        ctx,
        req: createJsonRequest("POST", {
          sessionId: previewBody.session.id,
          clarificationAnswers: { stance: "双方互惠" },
        }),
        res: confirm.res,
        url: new URL("http://127.0.0.1/api/triage/confirm"),
        pathname: "/api/triage/confirm",
        c: {},
      }),
    ).resolves.toBe(true);
    expect(confirm.status).toBe(200);
    expect(confirm.json()).toMatchObject({
      ok: true,
      session: { status: "confirmed" },
    });
  });
});

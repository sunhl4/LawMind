import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleTemplateRoutes } from "./lawmind-server-route-templates.js";
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

describe("handleTemplateRoutes", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    tempDirs.length = 0;
  });

  it("GET /api/templates returns built-in only (uploaded always empty)", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-tpl-api-"));
    tempDirs.push(workspaceDir);

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    const ok = await handleTemplateRoutes({
      ctx,
      req: { method: "GET", headers: {} } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/templates"),
      pathname: "/api/templates",
      c: {},
    });
    expect(ok).toBe(true);
    expect(cap.status).toBe(200);
    const j = cap.json() as {
      ok?: boolean;
      builtIn?: Array<{ id: string }>;
      uploaded?: unknown[];
    };
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.builtIn)).toBe(true);
    expect(j.builtIn?.some((t) => t.id === "word/legal-memo-default")).toBe(true);
    expect(j.uploaded).toEqual([]);
  });

  it("POST /api/templates/register is retired", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-tpl-reg-"));
    tempDirs.push(workspaceDir);

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    const ok = await handleTemplateRoutes({
      ctx,
      req: createJsonRequest("POST", {
        id: "upload/firm-letter",
        absolutePath: "/tmp/x.docx",
      }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/templates/register"),
      pathname: "/api/templates/register",
      c: {},
    });
    expect(ok).toBe(true);
    expect(cap.status).toBe(405);
    expect(cap.json()).toMatchObject({ ok: false });
    const error = cap.json().error;
    expect(typeof error === "string" ? error : "").toContain("不再支持上传");
  });

  it("POST /api/templates/scan is retired", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-tpl-scan-"));
    tempDirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    const ok = await handleTemplateRoutes({
      ctx,
      req: createJsonRequest("POST", { absolutePath: "/tmp/x.docx" }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/templates/scan"),
      pathname: "/api/templates/scan",
      c: {},
    });
    expect(ok).toBe(true);
    expect(cap.status).toBe(405);
  });
});

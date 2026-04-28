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

  it("GET /api/templates returns built-in and uploaded lists", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-tpl-api-"));
    tempDirs.push(workspaceDir);
    fs.mkdirSync(path.join(workspaceDir, "lawmind", "templates"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "lawmind", "templates", "index.json"),
      JSON.stringify({ templates: [] }),
      "utf8",
    );

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
    expect(Array.isArray(j.uploaded)).toBe(true);
  });

  it("POST /api/templates/register rejects invalid id", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-tpl-reg-"));
    tempDirs.push(workspaceDir);
    fs.mkdirSync(path.join(workspaceDir, "lawmind", "templates"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "lawmind", "templates", "index.json"),
      JSON.stringify({ templates: [] }),
      "utf8",
    );

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
        id: "bad id",
        path: "x.docx",
      }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/templates/register"),
      pathname: "/api/templates/register",
      c: {},
    });
    expect(ok).toBe(true);
    expect(cap.status).toBe(400);
    expect(cap.json()).toMatchObject({ ok: false });
  });
});

import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../../../src/lawmind/application/services/matter-write-service.js";
import { handleIntegrationsRoutes } from "./lawmind-server-route-integrations.js";
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

describe("lawmind-server-route-integrations", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("GET /api/integrations returns connector catalog", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-route-integ-"));
    tempDirs.push(ws);
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    const handled = await handleIntegrationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/integrations"),
      pathname: "/api/integrations",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const connectors = payload.connectors as Array<{ id: string }>;
    expect(connectors.some((c) => c.id === "filesystem")).toBe(true);
  });

  it("GET documents requires matterId", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-route-integ-"));
    tempDirs.push(ws);
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await handleIntegrationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/integrations/filesystem/documents"),
      pathname: "/api/integrations/filesystem/documents",
      c: {},
    });
    expect(capture.status).toBe(400);
    expect(capture.json().error).toBe("matter_id_required");
  });

  it("GET filesystem documents lists case files", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-route-integ-"));
    tempDirs.push(ws);
    createMatterIfMissing(ws, { matterId: "m-route-1", title: "Route" });
    const caseDir = path.join(ws, "cases", "m-route-1");
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, "brief.md"), "# brief");
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await handleIntegrationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL(
        "http://127.0.0.1/api/integrations/filesystem/documents?matterId=m-route-1",
      ),
      pathname: "/api/integrations/filesystem/documents",
      c: {},
    });
    expect(capture.status).toBe(200);
    const payload = capture.json();
    const docs = payload.documents as Array<{ name: string }>;
    expect(docs.some((d) => d.name === "brief.md")).toBe(true);
  });
});

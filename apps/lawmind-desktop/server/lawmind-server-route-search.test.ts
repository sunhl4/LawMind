import type http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emit } from "../../../src/lawmind/audit/index.js";
import { handleSearchRoutes } from "./lawmind-server-route-search.js";
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

describe("lawmind-server-route-search", () => {
  const dirs: string[] = [];
  const prevRebuild = process.env.LAWMIND_ALLOW_INDEX_REBUILD;

  afterEach(async () => {
    process.env.LAWMIND_ALLOW_INDEX_REBUILD = prevRebuild;
    for (const d of dirs.splice(0)) {
      await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("GET /api/search/workspace returns hits after rebuild", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-search-route-"));
    dirs.push(ws);
    await fs.mkdir(path.join(ws, "audit"), { recursive: true });
    await emit(path.join(ws, "audit"), {
      taskId: "task-search-1",
      kind: "task.created",
      actor: "system",
      detail: "workspaceSearchUniqueToken987",
    });
    process.env.LAWMIND_ALLOW_INDEX_REBUILD = "1";
    const ctx = { workspaceDir: ws } as LawmindDispatchContext;
    const rebuildCap = createResponseCapture();
    const rebuildReq = { method: "POST", headers: {} } as http.IncomingMessage;
    const rebuildUrl = new URL("http://127.0.0.1/api/search/workspace/rebuild");
    const rebuilt = await handleSearchRoutes({
      ctx,
      req: rebuildReq,
      res: rebuildCap.res,
      url: rebuildUrl,
      pathname: "/api/search/workspace/rebuild",
      c: {},
    });
    expect(rebuilt).toBe(true);
    expect(rebuildCap.status).toBe(200);

    const searchCap = createResponseCapture();
    const searchReq = { method: "GET", headers: {} } as http.IncomingMessage;
    const searchUrl = new URL(
      "http://127.0.0.1/api/search/workspace?q=workspaceSearchUniqueToken987",
    );
    const searched = await handleSearchRoutes({
      ctx,
      req: searchReq,
      res: searchCap.res,
      url: searchUrl,
      pathname: "/api/search/workspace",
      c: {},
    });
    expect(searched).toBe(true);
    expect(searchCap.status).toBe(200);
    const json = searchCap.json();
    expect(json.ok).toBe(true);
    const hits = json.hits as Array<{ source?: string }>;
    expect(hits.length).toBeGreaterThan(0);
  });

  it("POST rebuild returns 403 without env flag", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-search-route-deny-"));
    dirs.push(ws);
    delete process.env.LAWMIND_ALLOW_INDEX_REBUILD;
    const ctx = { workspaceDir: ws } as LawmindDispatchContext;
    const cap = createResponseCapture();
    const req = { method: "POST", headers: {} } as http.IncomingMessage;
    const handled = await handleSearchRoutes({
      ctx,
      req,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/search/workspace/rebuild"),
      pathname: "/api/search/workspace/rebuild",
      c: {},
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(403);
  });
});

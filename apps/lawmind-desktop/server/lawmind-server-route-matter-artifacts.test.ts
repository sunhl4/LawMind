import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleMatterArtifactRoutes } from "./lawmind-server-route-matter-artifacts.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function captureRes() {
  let status = 0;
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      if (h) {
        Object.assign(headers, h);
      }
      return res;
    },
    end(c?: string | Buffer) {
      body += c ? c.toString() : "";
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
    headers,
  };
}

function ctxFor(workspaceDir: string): LawmindDispatchContext {
  return {
    workspaceDir,
    envFile: undefined,
    userEnvPath: path.join(workspaceDir, ".env.lawmind"),
    policy: { loaded: false },
  };
}

const tmp: string[] = [];

afterEach(() => {
  for (const dir of tmp.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-artifacts-route-"));
  tmp.push(ws);
  return ws;
}

describe("handleMatterArtifactRoutes", () => {
  it("returns all three artifacts with missing statuses when nothing was generated", async () => {
    const workspaceDir = makeWs();
    const cap = captureRes();
    const handled = await handleMatterArtifactRoutes({
      pathname: "/api/matters/case-a/artifacts",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/case-a/artifacts"),
      c: {},
      ctx: ctxFor(workspaceDir),
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    const json = cap.json();
    expect(json.ok).toBe(true);
    const artifacts = json.artifacts as Record<string, { status: string }>;
    expect(artifacts["case-timeline"]?.status).toBe("missing");
    expect(artifacts["case-chronology"]?.status).toBe("missing");
    expect(artifacts["case-mindmap"]?.status).toBe("missing");
  });

  it("reads the visible case-root JSON files", async () => {
    const workspaceDir = makeWs();
    const caseDir = path.join(workspaceDir, "cases", "甲案");
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(
      path.join(caseDir, "project.case-timeline.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "case-timeline",
        events: [{ date: "2026-03-01", title: "立案", evidence: [{ filePath: "a.txt", lineRef: "L1" }] }],
      }),
    );
    const cap = captureRes();
    await handleMatterArtifactRoutes({
      pathname: `/api/matters/${encodeURIComponent("甲案")}/artifacts`,
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/%E7%94%B2%E6%A1%88/artifacts"),
      c: {},
      ctx: ctxFor(workspaceDir),
    });
    const artifacts = cap.json().artifacts as Record<string, { status: string; artifact?: unknown }>;
    expect(artifacts["case-timeline"]?.status).toBe("ok");
    expect(JSON.stringify(artifacts["case-timeline"]?.artifact)).toContain("立案");
  });

  it("rejects path traversal in the matter id", async () => {
    const cap = captureRes();
    const handled = await handleMatterArtifactRoutes({
      pathname: "/api/matters/..%2F..%2Fetc/artifacts",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/x/artifacts"),
      c: {},
      ctx: ctxFor(makeWs()),
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(400);
  });

  it("ignores other methods and paths", async () => {
    const cap = captureRes();
    const handled = await handleMatterArtifactRoutes({
      pathname: "/api/matters/case-a/artifacts",
      req: { method: "POST" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/case-a/artifacts"),
      c: {},
      ctx: ctxFor(makeWs()),
    });
    expect(handled).toBe(false);
  });
});

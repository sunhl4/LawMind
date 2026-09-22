import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { handleWorksRoutes } from "./lawmind-server-route-works.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const stream = new PassThrough();
  stream.end(JSON.stringify(body ?? {}), "utf8");
  (stream as unknown as http.IncomingMessage).method = method;
  return stream as unknown as http.IncomingMessage;
}

function mockRes(): { res: http.ServerResponse; status: () => number; json: () => Record<string, unknown> } {
  let status = 0;
  let raw = "";
  const res = {
    writeHead(s: number) {
      status = s;
    },
    end(b: string) {
      raw = b;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    status: () => status,
    json: () => JSON.parse(raw) as Record<string, unknown>,
  };
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("works routes", () => {
  it("creates, lists, and updates a work goal", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-works-api-"));
    dirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env"),
      policy: { loaded: false },
    };

    const created = mockRes();
    const posted = await handleWorksRoutes({
      ctx,
      req: jsonReq("POST", { goal: "审查供货合同", sessionId: "sess-1", source: "chat" }),
      res: created.res,
      url: new URL("http://127.0.0.1/api/works"),
      pathname: "/api/works",
      c: {},
    });
    expect(posted).toBe(true);
    expect(created.status()).toBe(201);
    const work = (created.json().work ?? {}) as { workId?: string; goal?: string };
    expect(work.goal).toBe("审查供货合同");
    expect(work.workId).toBeTruthy();

    const listed = mockRes();
    await handleWorksRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: listed.res,
      url: new URL("http://127.0.0.1/api/works?sessionId=sess-1"),
      pathname: "/api/works",
      c: {},
    });
    expect((listed.json().works as unknown[]).length).toBe(1);

    const updated = mockRes();
    await handleWorksRoutes({
      ctx,
      req: jsonReq("POST", { goal: "先对管辖" }),
      res: updated.res,
      url: new URL(`http://127.0.0.1/api/works/${work.workId}/goal`),
      pathname: `/api/works/${work.workId}/goal`,
      c: {},
    });
    expect(updated.status()).toBe(200);
    expect(((updated.json().work ?? {}) as { goal?: string }).goal).toBe("先对管辖");
  });

  it("saves a completed work as a weekly automation", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-works-auto-"));
    dirs.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env"),
      policy: { loaded: false },
    };
    const created = mockRes();
    await handleWorksRoutes({
      ctx,
      req: jsonReq("POST", {
        title: "审查供货合同",
        goal: "按附件审查",
        taskId: "e2e-draft-1",
        matterId: "matter-acme",
        source: "chat",
      }),
      res: created.res,
      url: new URL("http://127.0.0.1/api/works"),
      pathname: "/api/works",
      c: {},
    });
    const saved = mockRes();
    const handled = await handleWorksRoutes({
      ctx,
      req: jsonReq("POST", { taskId: "e2e-draft-1", matterId: "matter-acme" }),
      res: saved.res,
      url: new URL("http://127.0.0.1/api/works/automation"),
      pathname: "/api/works/automation",
      c: {},
    });
    expect(handled).toBe(true);
    expect(saved.status()).toBe(201);
    const automation = (saved.json().automation ?? {}) as { title?: string; matterId?: string };
    expect(automation.matterId).toBe("matter-acme");
    expect(automation.title).toContain("例行");
  });
});

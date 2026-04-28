import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { clearWorkflowJobsForTests, enqueueWorkflowRun } from "./lawmind-server-jobs.js";
import { handleJobRoutes } from "./lawmind-server-route-jobs.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import type { CollaborationWorkflow } from "../../../src/lawmind/agent/orchestrator/types.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import os from "node:os";
import path from "node:path";

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

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-route-jobs-"));
}

function stubConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    model: {
      provider: "openai-compatible",
      baseUrl: "http://localhost",
      apiKey: "k",
      model: "m",
    },
  };
}

function minimalWorkflow(): CollaborationWorkflow {
  const now = new Date().toISOString();
  return {
    workflowId: "wf-x",
    name: "n",
    description: "d",
    steps: [],
    status: "completed",
    createdBy: "u",
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(() => {
  clearWorkflowJobsForTests();
});

describe("lawmind-server-route-jobs", () => {
  it("returns 404 for unknown job", () => {
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const handled = handleJobRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/jobs/nope"),
      pathname: "/api/jobs/nope",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(404);
  });

  it("returns 400 for invalid job id path segment", () => {
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const badSeg = encodeURIComponent("x/y");
    const handled = handleJobRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL(`http://127.0.0.1/api/jobs/${badSeg}/stream`),
      pathname: `/api/jobs/${badSeg}/stream`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(400);
    expect((capture.json() as { error?: string }).error).toBe("invalid_job_id");
  });

  it("GET /api/jobs/:id returns job payload", async () => {
    const ws = tmpWorkspace();
    const jobId = enqueueWorkflowRun(stubConfig(ws), minimalWorkflow(), {
      run: async (_c, w) => w,
    });
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = handleJobRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL(`http://127.0.0.1/api/jobs/${jobId}`),
      pathname: `/api/jobs/${jobId}`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const job = payload.job as { status: string; result?: { report: string } };
    expect(job.status).toBe("completed");
    expect(job.result?.report).toBeTruthy();
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("GET /api/jobs/:id/stream sends SSE and closes for terminal job", async () => {
    const ws = tmpWorkspace();
    const jobId = enqueueWorkflowRun(stubConfig(ws), minimalWorkflow(), {
      run: async (_c, w) => w,
    });
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    let httpStatus = 0;
    const written: string[] = [];
    const res = {
      writeHead(code: number, _headers: Record<string, string>) {
        httpStatus = code;
      },
      write(chunk: string) {
        written.push(chunk);
        return true;
      },
      end() {
        written.push("__END__");
      },
      writableEnded: false,
    } as unknown as http.ServerResponse;
    const req = {
      method: "GET",
      on() {
        return req;
      },
    } as unknown as http.IncomingMessage;
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = handleJobRoutes({
      ctx,
      req,
      res,
      url: new URL(`http://127.0.0.1/api/jobs/${jobId}/stream`),
      pathname: `/api/jobs/${jobId}/stream`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(httpStatus).toBe(200);
    expect(written[0]).toContain("data:");
    expect(written[0]).toContain(jobId);
    expect(written.some((w) => w === "__END__")).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("GET /api/jobs/:id/stream 404 when workspaceDir does not match", async () => {
    const ws = tmpWorkspace();
    const jobId = enqueueWorkflowRun(stubConfig(ws), minimalWorkflow(), {
      run: async (_c, w) => w,
    });
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: path.join(os.tmpdir(), "other-ws-not-real"),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const handled = handleJobRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL(`http://127.0.0.1/api/jobs/${jobId}/stream`),
      pathname: `/api/jobs/${jobId}/stream`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(404);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("GET /api/jobs filters by status and workspaceDir", async () => {
    const ws = tmpWorkspace();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    enqueueWorkflowRun(stubConfig(ws), minimalWorkflow({ workflowId: "done" }), {
      run: async (_c, w) => w,
    });
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    enqueueWorkflowRun(stubConfig(ws), minimalWorkflow({ workflowId: "hang" }), {
      run: async () => new Promise(() => {}),
    });
    const cap = createResponseCapture();
    const handled = handleJobRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/jobs?limit=20&status=completed"),
      pathname: "/api/jobs",
      c: {},
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    const payload = cap.json();
    const rows = payload.jobs as Array<{ status: string }>;
    expect(rows.every((j) => j.status === "completed")).toBe(true);
    expect(rows.length).toBe(1);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("POST /api/jobs/:id/cancel returns 200 then 409", () => {
    const ws = tmpWorkspace();
    const jobId = enqueueWorkflowRun(stubConfig(ws), minimalWorkflow(), {
      run: async () => new Promise(() => {}),
    });
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap1 = createResponseCapture();
    const handled1 = handleJobRoutes({
      ctx,
      req: { method: "POST" } as http.IncomingMessage,
      res: cap1.res,
      url: new URL(`http://127.0.0.1/api/jobs/${jobId}/cancel`),
      pathname: `/api/jobs/${jobId}/cancel`,
      c: {},
    });
    expect(handled1).toBe(true);
    expect(cap1.status).toBe(200);
    expect(cap1.json().ok).toBe(true);

    const cap2 = createResponseCapture();
    const handled2 = handleJobRoutes({
      ctx,
      req: { method: "POST" } as http.IncomingMessage,
      res: cap2.res,
      url: new URL(`http://127.0.0.1/api/jobs/${jobId}/cancel`),
      pathname: `/api/jobs/${jobId}/cancel`,
      c: {},
    });
    expect(handled2).toBe(true);
    expect(cap2.status).toBe(409);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("returns false for unrelated path", () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    expect(
      handleJobRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: {} as http.ServerResponse,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).toBe(false);
  });
});

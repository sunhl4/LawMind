import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCollaborationRoutes } from "./lawmind-server-route-collaboration.js";
import { clearWorkflowJobsForTests, getWorkflowJob } from "./lawmind-server-jobs.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import type { CollaborationWorkflow } from "../../../src/lawmind/agent/orchestrator/types.js";

const mockExecute = vi.hoisted(() =>
  vi.fn<(base: unknown, workflow: CollaborationWorkflow) => Promise<CollaborationWorkflow>>(),
);

vi.mock("../../../src/lawmind/agent/orchestrator/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lawmind/agent/orchestrator/index.js")>(
    "../../../src/lawmind/agent/orchestrator/index.js",
  );
  return {
    ...actual,
    executeWorkflow: mockExecute,
  };
});

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

function postReq(json: unknown): http.IncomingMessage {
  const req = {
    method: "POST",
    headers: {},
  } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(json)));
      }
      if (event === "end") {
        handler();
      }
      return req;
    },
  });
  return req;
}

describe("lawmind-server-route-collaboration async workflow-run", () => {
  beforeEach(() => {
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "sk-test");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "demo");
    vi.stubEnv("LAWMIND_ENABLE_COLLABORATION", "true");
    mockExecute.mockReset();
    const now = new Date().toISOString();
    mockExecute.mockImplementation(async (_base, workflow) => ({
      ...workflow,
      status: "completed" as const,
      steps: workflow.steps.map((s) => ({ ...s, status: "completed" as const })),
      updatedAt: now,
      completedAt: now,
    }));
  });

  afterEach(() => {
    clearWorkflowJobsForTests();
    vi.unstubAllEnvs();
  });

  it("POST workflow-run with async:true returns 202 and job completes", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-collab-async-"));
    const wfDir = path.join(workspaceDir, "lawmind", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "demo.json"),
      JSON.stringify({
        id: "demo",
        name: "Demo",
        description: "d",
        steps: [{ stepId: "a", assignee: "x", task: "t", dependsOn: [] }],
      }),
      "utf8",
    );
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleCollaborationRoutes({
      ctx,
      req: postReq({ templateId: "demo", async: true }),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/collaboration/workflow-run"),
      pathname: "/api/collaboration/workflow-run",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(202);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const jobId = payload.jobId as string;
    expect(typeof jobId).toBe("string");

    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));

    const job = getWorkflowJob(jobId);
    expect(job?.status).toBe("completed");
    expect(mockExecute).toHaveBeenCalledOnce();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });
});

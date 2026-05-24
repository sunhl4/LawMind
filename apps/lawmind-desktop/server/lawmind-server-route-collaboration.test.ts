import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertAssistant } from "../../../src/lawmind/assistants/store.js";
import { handleCollaborationRoutes } from "./lawmind-server-route-collaboration.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

vi.mock("../../../src/lawmind/agent/tools/coordination/delegate.js", () => ({
  startDelegation: vi.fn(() => ({
    ok: true,
    data: {
      delegationId: "del-test-1",
      targetAssistant: "assistant-b",
      status: "running",
      note: "mock delegation",
    },
  })),
}));

vi.mock("./lawmind-server-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lawmind-server-helpers.js")>();
  return {
    ...actual,
    buildAgentConfig: vi.fn(() => ({
      config: {
        workspaceDir: "/tmp",
        model: {
          provider: "openai-compatible" as const,
          baseUrl: "http://127.0.0.1:9",
          apiKey: "test",
          model: "test-model",
        },
      },
      modelId: "builtin:qwen-plus",
    })),
  };
});

function createResponseCapture() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus;
      void nextHeaders;
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

describe("lawmind-server-route-collaboration", () => {
  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    await expect(
      handleCollaborationRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: {} as http.ServerResponse,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("lists workflow templates from workspace", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-collab-wf-"));
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
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/collaboration/workflow-templates"),
      pathname: "/api/collaboration/workflow-templates",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const templates = payload.templates as Array<{ id: string }>;
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.some((t) => t.id === "demo")).toBe(true);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("rejects POST /api/delegations without required fields", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-collab-del-"));
    const capture = createResponseCapture();
    const req = {
      method: "POST",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(Buffer.from(JSON.stringify({ fromAssistantId: "a" })));
        }
        if (event === "end") {
          handler();
        }
        return this;
      },
    });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleCollaborationRoutes({
      ctx,
      req,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/delegations"),
      pathname: "/api/delegations",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(400);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe("POST /api/delegations success path", () => {
    let lawMindRoot = "";
    let workspaceDir = "";
    const prevCollab = process.env.LAWMIND_ENABLE_COLLABORATION;

    beforeEach(() => {
      lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-collab-del-root-"));
      workspaceDir = path.join(lawMindRoot, "workspace");
      fs.mkdirSync(workspaceDir, { recursive: true });
      upsertAssistant(lawMindRoot, {
        assistantId: "assistant-a",
        displayName: "助手 A",
        introduction: "",
      });
      upsertAssistant(lawMindRoot, {
        assistantId: "assistant-b",
        displayName: "助手 B",
        introduction: "",
      });
      const envPath = path.join(lawMindRoot, ".env.lawmind");
      fs.writeFileSync(envPath, "DASHSCOPE_API_KEY=test-key\n", "utf8");
      process.env.LAWMIND_ENABLE_COLLABORATION = "true";
    });

    afterEach(() => {
      if (lawMindRoot) {
        fs.rmSync(lawMindRoot, { recursive: true, force: true });
      }
      if (prevCollab === undefined) {
        delete process.env.LAWMIND_ENABLE_COLLABORATION;
      } else {
        process.env.LAWMIND_ENABLE_COLLABORATION = prevCollab;
      }
    });

    it("creates delegation when model and assistants are available", async () => {
      const capture = createResponseCapture();
      const body = {
        fromAssistantId: "assistant-a",
        toAssistantId: "assistant-b",
        task: "请审查合同第三章违约责任",
      };
      const req = {
        method: "POST",
        headers: {},
      } as http.IncomingMessage;
      Object.assign(req, {
        on(event: string, handler: (...args: unknown[]) => void) {
          if (event === "data") {
            handler(Buffer.from(JSON.stringify(body)));
          }
          if (event === "end") {
            handler();
          }
          return this;
        },
      });
      const ctx: LawmindDispatchContext = {
        workspaceDir,
        envFile: path.join(lawMindRoot, ".env.lawmind"),
        userEnvPath: path.join(lawMindRoot, ".env.lawmind"),
        policy: { loaded: false },
      };
      const handled = await handleCollaborationRoutes({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/delegations"),
        pathname: "/api/delegations",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      const payload = capture.json();
      expect(payload.ok).toBe(true);
      expect(payload.delegationId).toBe("del-test-1");
    });
  });
});

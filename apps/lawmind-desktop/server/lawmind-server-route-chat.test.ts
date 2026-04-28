import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatRoute } from "./lawmind-server-route-chat.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

const mockChat = vi.fn();

vi.mock("../../../src/lawmind/agent/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lawmind/agent/index.js")>(
    "../../../src/lawmind/agent/index.js",
  );
  return {
    ...actual,
    createLawMindAgent: () => ({
      chat: mockChat,
    }),
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

describe("lawmind-server-route-chat", () => {
  beforeEach(() => {
    mockChat.mockReset();
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "sk-test");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "demo");
  });

  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await expect(
      handleChatRoute({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("validates empty chat message", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const req = {
      method: "POST",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(Buffer.from(JSON.stringify({ message: "   " })));
        }
        if (event === "end") {
          handler();
        }
        return this;
      },
    });
    const capture = createResponseCapture();

    await expect(
      handleChatRoute({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/chat"),
        pathname: "/api/chat",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({
      ok: false,
      code: "message_required",
    });
  });

  it("returns clarification questions from agent turn", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-route-"));
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# profile\n", "utf8");
    const lawMindRoot = path.join(workspaceDir, "..");
    fs.writeFileSync(
      path.join(lawMindRoot, "assistants.json"),
      JSON.stringify([
        {
          assistantId: "default",
          displayName: "默认助手",
          introduction: "测试助手",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      "utf8",
    );
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    mockChat.mockResolvedValue({
      reply: "请先补充租金和押金。",
      sessionId: "sess-1",
      turn: {
        turnId: "turn-1",
        sessionId: "sess-1",
        instruction: "请起草一份房屋租赁合同",
        messages: [],
        toolCallsExecuted: 1,
        status: "awaiting_clarification",
        clarificationQuestions: [
          {
            key: "rent_and_deposit",
            question: "请补充租金、押金和支付周期。",
          },
        ],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    });
    const req = {
      method: "POST",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(Buffer.from(JSON.stringify({ message: "请起草一份房屋租赁合同" })));
        }
        if (event === "end") {
          handler();
        }
        return this;
      },
    });
    const capture = createResponseCapture();

    await expect(
      handleChatRoute({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/chat"),
        pathname: "/api/chat",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(200);
    expect(capture.json()).toMatchObject({
      ok: true,
      status: "awaiting_clarification",
      clarificationQuestions: [
        {
          key: "rent_and_deposit",
          question: "请补充租金、押金和支付周期。",
        },
      ],
    });
  });

  it("includes runtimeHints when includeTurnDiagnostics is true", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-diag-"));
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# profile\n", "utf8");
    const lawMindRoot = path.join(workspaceDir, "..");
    fs.writeFileSync(
      path.join(lawMindRoot, "assistants.json"),
      JSON.stringify([
        {
          assistantId: "default",
          displayName: "默认助手",
          introduction: "测试助手",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      "utf8",
    );
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    mockChat.mockResolvedValue({
      reply: "ok",
      sessionId: "sess-d",
      turn: {
        turnId: "turn-d",
        sessionId: "sess-d",
        instruction: "hi",
        messages: [],
        toolCallsExecuted: 2,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    });
    const req = {
      method: "POST",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(
            Buffer.from(JSON.stringify({ message: "hello", includeTurnDiagnostics: true })),
          );
        }
        if (event === "end") {
          handler();
        }
        return this;
      },
    });
    const capture = createResponseCapture();
    await handleChatRoute({
      ctx,
      req,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/chat"),
      pathname: "/api/chat",
      c: {},
    });
    const j = capture.json();
    expect(j.runtimeHints).toEqual(
      expect.objectContaining({
        lawmindRouterMode: expect.any(String),
        lawmindReasoningMode: expect.any(String),
        toolCallsExecuted: 2,
      }),
    );
  });
});

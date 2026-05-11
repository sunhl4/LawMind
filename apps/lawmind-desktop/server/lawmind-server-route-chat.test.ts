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
          handler(Buffer.from(JSON.stringify({ message: "请起草一份房屋租赁合同", matterId: "matter-lease" })));
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
            Buffer.from(
              JSON.stringify({
                message: "hello",
                includeTurnDiagnostics: true,
                matterId: "matter-d",
              }),
            ),
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

  it("allows unscoped chat by default", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-unscoped-"));
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
      reply: "hi",
      sessionId: "sess-u",
      turn: {
        turnId: "turn-u",
        sessionId: "sess-u",
        instruction: "",
        messages: [],
        toolCallsExecuted: 0,
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
          handler(Buffer.from(JSON.stringify({ message: "hello unscoped" })));
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
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(capture.status).toBe(200);
    expect(capture.json()).toMatchObject({ ok: true, reply: "hi" });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("rejects meetingMode without matterId", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-meet-"));
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# profile\n", "utf8");
    fs.writeFileSync(
      path.join(root, "assistants.json"),
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
    const req = {
      method: "POST",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(
            Buffer.from(
              JSON.stringify({
                message: "hello",
                meetingMode: true,
                contextPins: [{ root: "workspace", relPath: "MEMORY.md", kind: "file" }],
              }),
            ),
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
    expect(mockChat).not.toHaveBeenCalled();
    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({ ok: false, code: "meeting_matter_required" });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("meetingMode prefixes instruction and appends team-meeting.jsonl", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-meet2-"));
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# profile\n", "utf8");
    fs.mkdirSync(path.join(workspaceDir, "cases", "matter-meet"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "assistants.json"),
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
      reply: "收到",
      sessionId: "sess-meet",
      turn: {
        turnId: "turn-meet",
        sessionId: "sess-meet",
        instruction: "",
        messages: [],
        toolCallsExecuted: 0,
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
            Buffer.from(
              JSON.stringify({
                message: "议题 A",
                matterId: "matter-meet",
                meetingMode: true,
              }),
            ),
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
    expect(capture.status).toBe(200);
    expect(mockChat).toHaveBeenCalledTimes(1);
    const firstArg = mockChat.mock.calls[0][0] as string;
    expect(firstArg).toContain("本会发言主题");
    expect(firstArg).toContain("议题 A");
    expect(mockChat.mock.calls[0][1]).toMatchObject({ teamMeetingMode: true });
    const tmPath = path.join(workspaceDir, "cases", "matter-meet", "team-meeting.jsonl");
    const raw = fs.readFileSync(tmPath, "utf8").trim().split("\n").filter(Boolean);
    expect(raw.length).toBe(2);
    const u = JSON.parse(raw[0]) as { kind: string; text: string };
    const a = JSON.parse(raw[1]) as { kind: string; text: string };
    expect(u.kind).toBe("user");
    expect(u.text).toBe("议题 A");
    expect(a.kind).toBe("assistant");
    expect(a.text).toBe("收到");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("meetingMode injects meetingAgenda into instruction but not jsonl user line", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-meet-agenda-"));
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# memory\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# profile\n", "utf8");
    fs.mkdirSync(path.join(workspaceDir, "cases", "matter-ag"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "assistants.json"),
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
      sessionId: "sess-a",
      turn: {
        turnId: "turn-a",
        sessionId: "sess-a",
        instruction: "",
        messages: [],
        toolCallsExecuted: 0,
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
            Buffer.from(
              JSON.stringify({
                message: "短指示",
                matterId: "matter-ag",
                meetingMode: true,
                meetingAgenda: "讨论管辖",
              }),
            ),
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
    expect(capture.status).toBe(200);
    const firstArg = mockChat.mock.calls[0][0] as string;
    expect(firstArg).toContain("会议议程");
    expect(firstArg).toContain("讨论管辖");
    const tmPath = path.join(workspaceDir, "cases", "matter-ag", "team-meeting.jsonl");
    const raw = fs.readFileSync(tmPath, "utf8").trim().split("\n").filter(Boolean);
    const u = JSON.parse(raw[0]) as { text: string };
    expect(u.text).toBe("短指示");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

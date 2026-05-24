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

/** Parse SSE blocks written via `event:` + `data:` (ignores `: ping` comment lines inside blocks). */
function parseNamedSseEvents(chunks: string[]): Array<{ name: string; data: unknown }> {
  const raw = chunks.filter((c) => c !== "__END__").join("");
  const out: Array<{ name: string; data: unknown }> = [];
  for (const block of raw.split("\n\n").filter((b) => b.trim().length > 0)) {
    let ev = "";
    const dataPieces: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        ev = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataPieces.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataPieces.length) {
      const joined = dataPieces.join("");
      out.push({ name: ev, data: JSON.parse(joined) });
    }
  }
  return out;
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
        executionState: {
          phase: "clarify",
          status: "awaiting_clarification",
          recoverable: true,
        },
        gateDecisions: [
          {
            gate: "clarification_gate",
            decision: "awaiting_confirmation",
            reason: "need lawyer input",
          },
        ],
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
      executionState: {
        phase: "clarify",
        status: "awaiting_clarification",
      },
      gateDecisions: [
        {
          gate: "clarification_gate",
          decision: "awaiting_confirmation",
        },
      ],
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

  it("includes sourceType in toolCallSequence for document reads", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-seq-"));
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
    const iso = new Date().toISOString();
    mockChat.mockResolvedValue({
      reply: "ok",
      sessionId: "sess-seq",
      turn: {
        turnId: "turn-seq",
        sessionId: "sess-seq",
        instruction: "hi",
        messages: [
          {
            role: "assistant",
            content: "",
            timestamp: iso,
            toolCalls: [{ id: "call_a", name: "read_project_file", arguments: {} }],
          },
          {
            role: "tool",
            content: "{}",
            timestamp: iso,
            toolCallResponses: [
              {
                toolCallId: "call_a",
                name: "read_project_file",
                result: { ok: true, data: { sourceType: "pdf_ocr", content: "x" } },
              },
            ],
          },
          {
            role: "assistant",
            content: "",
            timestamp: iso,
            toolCalls: [
              { id: "call_b", name: "analyze_document", arguments: {} },
              { id: "call_c", name: "search_cases", arguments: {} },
            ],
          },
          {
            role: "tool",
            content: "{}",
            timestamp: iso,
            toolCallResponses: [
              {
                toolCallId: "call_b",
                name: "analyze_document",
                result: { ok: true, data: { sourceType: "image_vision", filePath: "/f" } },
              },
            ],
          },
          {
            role: "tool",
            content: "{}",
            timestamp: iso,
            toolCallResponses: [
              {
                toolCallId: "call_c",
                name: "search_cases",
                result: { ok: true, data: { hits: [] } },
              },
            ],
          },
        ],
        toolCallsExecuted: 3,
        status: "completed",
        startedAt: iso,
        completedAt: iso,
      },
    });
    const req = {
      method: "POST",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(Buffer.from(JSON.stringify({ message: "hello" })));
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
    expect(capture.json().toolCallSequence).toEqual([
      "read_project_file（PDF·OCR）",
      "analyze_document（图片·视觉）",
      "search_cases",
    ]);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
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

  it("forwards linkedTaskId to agent.chat and echoes in JSON when set", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-linked-"));
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
      sessionId: "sess-link",
      turn: {
        turnId: "turn-link",
        sessionId: "sess-link",
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
                message: "hello",
                linkedTaskId: "abc-draft-01",
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
    expect(capture.json()).toMatchObject({ ok: true, linkedTaskId: "abc-draft-01" });
    expect(mockChat.mock.calls[0][1]).toMatchObject({ linkedTaskId: "abc-draft-01" });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("rejects invalid linkedTaskId", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-badlink-"));
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
                linkedTaskId: "has space",
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
    expect(capture.json()).toMatchObject({ ok: false, code: "invalid_linked_task_id" });
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

  describe("SSE /api/chat streaming", () => {
    function sseResponseCapture(): {
      res: http.ServerResponse;
      chunks: string[];
      get httpStatus(): number;
    } {
      let httpStatus = 0;
      const chunks: string[] = [];
      const res = {
        writableEnded: false,
        headersSent: false,
        writeHead(code: number, _headers: Record<string, string>) {
          httpStatus = code;
          return res;
        },
        write(line: string) {
          chunks.push(line);
          return true;
        },
        end(fragment?: string) {
          if (fragment) {chunks.push(fragment.toString());}
          chunks.push("__END__");
        },
      } as unknown as http.ServerResponse;
      return {
        res,
        chunks,
        get httpStatus() {
          return httpStatus;
        },
      };
    }

    function minimalWorkspaceDirs() {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-chat-sse-"));
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
      return { workspaceDir };
    }

    function streamReq(message: string): http.IncomingMessage {
      const req = {
        method: "POST",
        headers: { accept: "text/event-stream" },
      } as http.IncomingMessage;
      Object.assign(req, {
        on(event: string, handler?: (...args: unknown[]) => void) {
          if (event === "data" && handler) {
            handler(Buffer.from(JSON.stringify({ message })));
          }
          if (event === "end" && handler) {
            handler();
          }
          if (event === "close") {
            /* keep listeners registered; invoking close eagerly would sseEnd before agent.chat completes */
          }
          return req;
        },
      });
      return req;
    }

    it("emits SSE event sequence ending with payload and done", async () => {
      const { workspaceDir } = minimalWorkspaceDirs();
      mockChat.mockImplementation(async (_instruction, opts) => {
        expect(opts?.onEvent).toBeTypeOf("function");
        opts?.onEvent?.({ type: "round_start", roundIndex: 1 });
        opts?.onEvent?.({ type: "delta", roundIndex: 1, text: "partial" });
        opts?.onEvent?.({ type: "final", status: "completed", reply: "full reply" });
        return {
          reply: "full reply",
          sessionId: "sess-sse",
          turn: {
            turnId: "turn-sse",
            sessionId: "sess-sse",
            instruction: "",
            messages: [],
            toolCallsExecuted: 0,
            status: "completed",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        };
      });
      const ctx: LawmindDispatchContext = {
        workspaceDir,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const cap = sseResponseCapture();
      await handleChatRoute({
        ctx,
        req: streamReq("hello stream"),
        res: cap.res,
        url: new URL("http://127.0.0.1/api/chat"),
        pathname: "/api/chat",
        c: {},
      });
      expect(cap.httpStatus).toBe(200);
      const events = parseNamedSseEvents(cap.chunks).map((e) => e.name);
      expect(events).toContain("round_start");
      expect(events).toContain("delta");
      expect(events).toContain("final_reply");
      expect(events.some((n) => n === "payload")).toBe(true);
      expect(events[events.length - 1]).toBe("done");
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it("JSON Accept branch does not pass onEvent", async () => {
      const { workspaceDir } = minimalWorkspaceDirs();
      mockChat.mockResolvedValue({
        reply: "json",
        sessionId: "sess-j",
        turn: {
          turnId: "turn-j",
          sessionId: "sess-j",
          instruction: "",
          messages: [],
          toolCallsExecuted: 0,
          status: "completed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      });
      const ctx: LawmindDispatchContext = {
        workspaceDir,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const req = {
        method: "POST",
        headers: { accept: "application/json" },
      } as http.IncomingMessage;
      Object.assign(req, {
        on(event: string, handler: (...args: unknown[]) => void) {
          if (event === "data") {
            handler(Buffer.from(JSON.stringify({ message: "no sse" })));
          }
          if (event === "end") {
            handler();
          }
          return req;
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
      expect(mockChat.mock.calls[0][1]).toMatchObject({ onEvent: undefined });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    });
  });
});

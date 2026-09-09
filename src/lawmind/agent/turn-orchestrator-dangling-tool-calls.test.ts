/**
 * 悬空 tool_call 端到端：模型同一轮发出多个调用，前序调用待审批中断时，
 * 剩余调用必须补写配对 tool 消息；持久化历史与 deriveModelMessages 投影
 * （resume 后直送 OpenAI 兼容 API 的序列）都必须配对完整。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTurn } from "./runtime.js";
import { findUnpairedToolCallIds } from "./session-tool-call-pairing.js";
import { deriveModelMessages, loadSession } from "./session.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-dangling-"));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");
  return dir;
}

function baseConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    strictDangerousToolApproval: true,
    model: {
      provider: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "demo",
    },
  };
}

/** 第一轮模型同时发出 send_email（需审批）+ write_document 两个调用。 */
function stubModelWithTwoToolCalls() {
  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "send_email", arguments: JSON.stringify({ to: "a@b.com" }) },
              },
              {
                id: "call-2",
                type: "function",
                function: { name: "write_document", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        const next = responses.shift();
        if (next === undefined) {
          throw new Error("unexpected extra model call");
        }
        return next;
      },
    })),
  );
}

describe("dangling tool_calls (P0)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("approval interrupt pairs every tool_call; persisted + derived history stay sendable", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let mailExecuted = false;
    let writeExecuted = false;
    registry.register({
      definition: {
        name: "send_email",
        description: "send mail",
        category: "draft",
        parameters: { to: { type: "string" } },
        requiresApproval: true,
      },
      async execute() {
        mailExecuted = true;
        return { ok: true };
      },
    });
    registry.register({
      definition: {
        name: "write_document",
        description: "write doc",
        category: "draft",
        parameters: {},
      },
      async execute() {
        writeExecuted = true;
        return { ok: true };
      },
    });
    stubModelWithTwoToolCalls();

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请发邮件并落稿",
    });

    expect(result.turn.status).toBe("awaiting_approval");
    expect(mailExecuted).toBe(false);
    expect(writeExecuted).toBe(false);

    // turn 历史：assistant 两个 tool_call 各有配对 tool 消息，第二个是「已跳过」。
    const toolMsgs = result.turn.messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]?.toolCallResponses?.[0]?.toolCallId).toBe("call-1");
    expect(toolMsgs[1]?.toolCallResponses?.[0]?.toolCallId).toBe("call-2");
    expect(toolMsgs[1]?.toolCallResponses?.[0]?.result.ok).toBe(false);
    expect(toolMsgs[1]?.toolCallResponses?.[0]?.result.error).toContain("已跳过");
    expect(findUnpairedToolCallIds(result.turn.messages)).toEqual([]);

    // resume 路径：磁盘历史与送出投影都必须配对完整（否则 OpenAI 兼容 API 400）。
    const persisted = loadSession(workspaceDir, result.sessionId);
    expect(persisted).toBeDefined();
    expect(findUnpairedToolCallIds(persisted!.conversationHistory)).toEqual([]);
    const derived = deriveModelMessages(persisted!);
    const assistantIdx = derived.findIndex((m) => m.tool_calls?.length === 2);
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    const followingToolIds = derived
      .slice(assistantIdx + 1)
      .filter((m) => m.role === "tool")
      .map((m) => m.tool_call_id);
    expect(followingToolIds).toEqual(["call-1", "call-2"]);
  });

  it("deriveModelMessages repairs legacy poisoned history (missing tool responses)", () => {
    const session = {
      sessionId: "sess-legacy",
      actorId: "lawyer",
      turns: [],
      conversationHistory: [
        { role: "user" as const, content: "改合同", timestamp: "t1" },
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [
            { id: "call-old-1", name: "send_email", arguments: {} },
            { id: "call-old-2", name: "write_document", arguments: {} },
          ],
          timestamp: "t2",
        },
        {
          role: "tool" as const,
          content: JSON.stringify({ ok: false, approvalRequest: true }),
          toolCallResponses: [
            {
              toolCallId: "call-old-1",
              name: "send_email",
              result: { ok: false, approvalRequest: true },
            },
          ],
          timestamp: "t3",
        },
      ],
      createdAt: "t0",
      updatedAt: "t0",
    };
    // 旧版本残留：call-old-2 无配对 tool 消息。
    expect(findUnpairedToolCallIds(session.conversationHistory)).toEqual(["call-old-2"]);
    const derived = deriveModelMessages(session);
    // 修复写回 session：历史自身配对完整。
    expect(findUnpairedToolCallIds(session.conversationHistory)).toEqual([]);
    const toolCallIds = derived.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
    expect(toolCallIds).toEqual(["call-old-1", "call-old-2"]);
    const healed = derived.find((m) => m.tool_call_id === "call-old-2");
    expect(JSON.parse(healed!.content).ok).toBe(false);
  });
});

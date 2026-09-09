/**
 * 权限模式执行层化端到端：
 * - readonly 轮里模型绕过广告清单直接点名写工具 → 管线硬拦（不依赖 prompt 过滤）。
 * - prompt「可用工具」目录与发给模型的 tools 均由本轮生效工具集生成（单一真相源）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTurn } from "./runtime.js";
import { loadSession } from "./session.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function jsonBody(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-perm-gate-"));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");
  return dir;
}

function baseConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    model: {
      provider: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "demo",
    },
  };
}

function buildRegistry(onWrite: () => void): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "analyze_document",
      description: "read",
      category: "analyze",
      parameters: {},
    },
    async execute() {
      return { ok: true, data: "read" };
    },
  });
  registry.register({
    definition: {
      name: "write_document",
      description: "write",
      category: "draft",
      parameters: {},
    },
    async execute() {
      onWrite();
      return { ok: true, data: { file_path: "x.md" } };
    },
  });
  registry.register({
    definition: {
      name: "list_more_tools",
      description: "more",
      category: "system",
      parameters: {},
    },
    async execute() {
      return { ok: true, data: {} };
    },
  });
  return registry;
}

/** stub 模型：第一轮点名写工具，第二轮收尾；同时记录每次请求的 tools 广告清单。 */
function stubModelAdversarialWrite(advertisedToolNames: string[][]): void {
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
                function: { name: "write_document", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
    {
      choices: [
        {
          message: { role: "assistant", content: "已处理。" },
          finish_reason: "stop",
        },
      ],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      const body = jsonBody(init?.body) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      if (Array.isArray(body.tools)) {
        advertisedToolNames.push(
          body.tools.map((t) => t.function?.name ?? "").filter((n) => n.length > 0),
        );
      }
      return {
        ok: true,
        json: async () => {
          const next = responses.shift();
          if (next === undefined) {
            throw new Error("unexpected extra model call");
          }
          return next;
        },
      };
    }),
  );
}

describe("permission mode execution-layer gate (e2e)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("readonly: model write call bypassing the ad list is hard-blocked by the pipeline", async () => {
    const workspaceDir = tmpWorkspace();
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    const advertised: string[][] = [];
    stubModelAdversarialWrite(advertised);

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "readonly",
    });

    // 写工具从未执行；错误话术引导模型改用只读工具或请律师切换模式。
    expect(writeExecuted).toBe(false);
    expect(result.turn.status).toBe("completed");
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("只读");
    expect(toolText).toContain("write_document");
    // 阻断决定落账：dangerous_tool_gate / block / safety_hard。
    expect(
      result.turn.gateDecisions?.some(
        (g) =>
          g.gate === "dangerous_tool_gate" &&
          g.decision === "block" &&
          g.category === "safety_hard",
      ),
    ).toBe(true);

    // 一致性：发给模型的 tools 广告清单本身也不含写工具（prompt 层过滤仍保留）。
    expect(advertised.length).toBeGreaterThan(0);
    for (const names of advertised) {
      expect(names).not.toContain("write_document");
      expect(names).toContain("analyze_document");
    }

    // 单一真相源：system prompt 的「可用工具」目录 = 本轮生效工具集。
    const session = loadSession(workspaceDir, result.sessionId);
    const systemPrompt = String(session?.conversationHistory[0]?.content ?? "");
    expect(systemPrompt).toContain("**analyze_document**");
    expect(systemPrompt).not.toContain("**write_document**");
    const promptToolNames = new Set(
      [...systemPrompt.matchAll(/\*\*([a-z_][a-z0-9_]*)\*\* \[/g)].map((m) => m[1]),
    );
    for (const names of advertised) {
      expect(new Set(names)).toEqual(promptToolNames);
    }
  });

  it("standard: the same write call executes (permission gate does not over-block)", async () => {
    const workspaceDir = tmpWorkspace();
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    const advertised: string[][] = [];
    stubModelAdversarialWrite(advertised);

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "standard",
    });

    expect(writeExecuted).toBe(true);
    expect(result.turn.status).toBe("completed");
    expect(result.turn.gateDecisions?.some((g) => g.gate === "dangerous_tool_gate")).toBe(false);
    // 标准模式下广告清单与 prompt 目录都含写工具。
    expect(advertised[0]).toContain("write_document");
    const session = loadSession(workspaceDir, result.sessionId);
    const systemPrompt = String(session?.conversationHistory[0]?.content ?? "");
    expect(systemPrompt).toContain("**write_document**");
  });

  it("research: write tools blocked, research_task stays in the advertised set", async () => {
    const workspaceDir = tmpWorkspace();
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    registry.register({
      definition: {
        name: "research_task",
        description: "research",
        category: "research",
        parameters: {},
      },
      async execute() {
        return { ok: true, data: {} };
      },
    });
    const advertised: string[][] = [];
    stubModelAdversarialWrite(advertised);

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "research",
    });

    expect(writeExecuted).toBe(false);
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("研究");
    expect(advertised[0]).toContain("research_task");
    expect(advertised[0]).not.toContain("write_document");
    const session = loadSession(workspaceDir, result.sessionId);
    const systemPrompt = String(session?.conversationHistory[0]?.content ?? "");
    expect(systemPrompt).toContain("**research_task**");
    expect(systemPrompt).not.toContain("**write_document**");
  });

  it("mid-session switch to readonly: frozen static catalog stays, pipeline still hard-blocks", async () => {
    // 静态前缀为 Provider 缓存而按会话冻结（applySystemPromptToHistory），
    // 中途切 readonly 不会重写首轮工具目录；当轮权限由动态 world-state 块告知，
    // 写工具调用由 permissionModeMiddleware 在执行层硬拦——prompt 只是提示层。
    const workspaceDir = tmpWorkspace();
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    const responses = [
      // turn 1（standard）：直接收尾。
      {
        choices: [
          {
            message: { role: "assistant", content: "好的。" },
            finish_reason: "stop",
          },
        ],
      },
      // turn 2（readonly）：模型点名写工具。
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-w",
                  type: "function",
                  function: { name: "write_document", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        choices: [
          {
            message: { role: "assistant", content: "已处理。" },
            finish_reason: "stop",
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

    const first = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "standard",
    });
    const second = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      sessionId: first.sessionId,
      instruction: "请导出审阅稿",
      permissionMode: "readonly",
    });

    expect(writeExecuted).toBe(false);
    const toolText = second.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("只读");
    // 静态目录冻结（仍含首轮写工具），但当轮权限块已切换为 readonly。
    const session = loadSession(workspaceDir, first.sessionId);
    const systemPrompt = String(session?.conversationHistory[0]?.content ?? "");
    expect(systemPrompt).toContain("**write_document**");
    expect(systemPrompt).toContain("权限模式：readonly");
  });
});

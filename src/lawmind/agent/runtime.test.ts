import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTurn, validateToolArguments } from "./runtime.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig, ToolDefinition } from "./types.js";

const def: ToolDefinition = {
  name: "demo_tool",
  description: "demo",
  category: "system",
  parameters: {
    query: { type: "string", description: "query", required: true },
    limit: { type: "number", description: "limit" },
    mode: { type: "string", description: "mode", enum: ["fast", "full"] },
  },
};

describe("validateToolArguments", () => {
  it("accepts valid arguments", () => {
    const error = validateToolArguments(def, { query: "abc", limit: 3, mode: "fast" });
    expect(error).toBeUndefined();
  });

  it("rejects unknown keys", () => {
    const error = validateToolArguments(def, { query: "abc", unknown: 1 });
    expect(error).toContain("unknown keys");
  });

  it("rejects missing required key", () => {
    const error = validateToolArguments(def, { mode: "fast" });
    expect(error).toContain("missing required key");
  });

  it("rejects wrong type", () => {
    const error = validateToolArguments(def, { query: "abc", limit: "3" });
    expect(error).toContain('key "limit" expects number');
  });

  it("rejects enum mismatch", () => {
    const error = validateToolArguments(def, { query: "abc", mode: "invalid" });
    expect(error).toContain('key "mode" must be one of');
  });
});

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-runtime-"));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# memory\n", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# profile\n", "utf8");
  return dir;
}

describe("runTurn clarification handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks turn as awaiting_clarification when drafting tool returns placeholder questions", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "draft_document",
        description: "draft document",
        category: "draft",
        parameters: {},
      },
      async execute() {
        return {
          ok: true,
          data: {
            title: "房屋租赁合同",
            deliveryReadiness: "draft_with_placeholders",
            clarificationQuestions: [
              {
                key: "rent_and_deposit",
                question: "请补充租金、押金和支付周期；若暂时没有，我会先保留标准占位条款。",
              },
            ],
          },
        };
      },
    });

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
                  function: { name: "draft_document", arguments: "{}" },
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
            message: {
              role: "assistant",
              content: "我已经先生成了一份正式草稿。",
            },
            finish_reason: "stop",
          },
        ],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => responses.shift(),
      })),
    );

    const config: AgentConfig = {
      workspaceDir,
      model: {
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        model: "demo",
      },
    };

    const result = await runTurn({
      config,
      registry,
      instruction: "请起草一份房屋租赁合同",
    });

    expect(result.turn.status).toBe("awaiting_clarification");
    expect(result.turn.clarificationQuestions?.[0]?.key).toBe("rent_and_deposit");
    expect(result.reply).toContain("我已经先生成了一份正式草稿。");
    expect(result.reply).toContain("请补充租金、押金和支付周期");
    expect(result.memoryContext).toBeDefined();
    expect(typeof result.memoryContext.profile).toBe("string");
  });

  it("second user turn after clarification persists session and allows draft_document to complete", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let draftCalls = 0;
    registry.register({
      definition: {
        name: "draft_document",
        description: "draft document",
        category: "draft",
        parameters: {},
      },
      async execute() {
        draftCalls += 1;
        if (draftCalls === 1) {
          return {
            ok: true,
            data: {
              title: "房屋租赁合同",
              deliveryReadiness: "draft_with_placeholders",
              clarificationQuestions: [
                {
                  key: "rent_and_deposit",
                  question: "请补充租金、押金和支付周期。",
                },
              ],
            },
          };
        }
        return {
          ok: true,
          data: {
            title: "房屋租赁合同",
            deliveryReadiness: "ready",
          },
        };
      },
    });

    const modelResponses: unknown[] = [
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-t1a",
                  type: "function",
                  function: { name: "draft_document", arguments: "{}" },
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
            message: {
              role: "assistant",
              content: "已生成待补充版草稿。",
            },
            finish_reason: "stop",
          },
        ],
      },
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-t2a",
                  type: "function",
                  function: { name: "draft_document", arguments: "{}" },
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
            message: {
              role: "assistant",
              content: "已按补充更新合同正文。",
            },
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
          const next = modelResponses.shift();
          if (next === undefined) {
            throw new Error("unexpected extra model call");
          }
          return next;
        },
      })),
    );

    const config: AgentConfig = {
      workspaceDir,
      model: {
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        model: "demo",
      },
    };

    const first = await runTurn({
      config,
      registry,
      instruction: "请起草一份房屋租赁合同",
    });
    expect(first.turn.status).toBe("awaiting_clarification");
    expect(first.sessionId).toMatch(/[0-9a-f-]{36}/i);

    const reloaded = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, "sessions", `${first.sessionId}.json`), "utf8"),
    ) as { pendingClarificationKeys?: string[] };
    expect(reloaded.pendingClarificationKeys).toEqual(["rent_and_deposit"]);

    const second = await runTurn({
      config,
      registry,
      sessionId: first.sessionId,
      instruction: "【补充信息】租金 5000 元/月，押一付三。请继续完善。",
    });

    expect(draftCalls).toBe(2);
    expect(second.turn.status).toBe("completed");
    expect(second.reply).toContain("已按补充更新合同正文");

    const after = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, "sessions", `${first.sessionId}.json`), "utf8"),
    ) as { pendingClarificationKeys?: string[] };
    expect(after.pendingClarificationKeys).toBeUndefined();
  });
});

describe("runTurn strict dangerous tool approval", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("awaits approval when strictDangerousToolApproval even if allowDangerousToolsWithoutApproval", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "risky",
        description: "r",
        category: "system",
        parameters: {},
        requiresApproval: true,
      },
      async execute() {
        return { ok: true, data: { done: true } };
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "risky", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      })),
    );

    const config: AgentConfig = {
      workspaceDir,
      model: {
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        model: "demo",
      },
      allowDangerousToolsWithoutApproval: true,
      strictDangerousToolApproval: true,
    };

    const result = await runTurn({
      config,
      registry,
      instruction: "run risky",
    });

    expect(result.turn.status).toBe("awaiting_approval");
  });

  it("runs requiresApproval tool when strict is off and allowDangerous bypass is on", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let ran = false;
    registry.register({
      definition: {
        name: "risky",
        description: "r",
        category: "system",
        parameters: {},
        requiresApproval: true,
      },
      async execute() {
        ran = true;
        return { ok: true, data: { done: true } };
      },
    });

    const responses: unknown[] = [
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "risky", arguments: "{}" },
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
            message: {
              role: "assistant",
              content: "已完成。",
            },
            finish_reason: "stop",
          },
        ],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => responses.shift(),
      })),
    );

    const config: AgentConfig = {
      workspaceDir,
      model: {
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        model: "demo",
      },
      allowDangerousToolsWithoutApproval: true,
      strictDangerousToolApproval: false,
    };

    const result = await runTurn({
      config,
      registry,
      instruction: "run risky",
    });

    expect(ran).toBe(true);
    expect(result.turn.status).toBe("completed");
    expect(result.reply).toContain("已完成");
  });
});

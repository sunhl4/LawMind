import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_FAST_LANE_DENIED_HINT } from "../platform/contract-fast-lane-instruction.js";
import { runTurn } from "./runtime.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-contract-lock-"));
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

function stubModelWithToolCall(toolName: string, argsJson: string) {
  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "call-1", type: "function", function: { name: toolName, arguments: argsJson } },
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
}

describe("contract fast-lane tool lock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects search_workspace on a 5-minute review turn", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let searched = false;
    registry.register({
      definition: {
        name: "search_workspace",
        description: "search",
        category: "search",
        parameters: {},
      },
      async execute() {
        searched = true;
        return { ok: true, data: { hits: [] } };
      },
    });
    stubModelWithToolCall("search_workspace", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: [
        "【交办】5 分钟合同审查",
        "交付物类型：合同审查意见",
        "- 合同/材料说明：nda.docx",
        "- 审查重点：付款与违约",
        "- 己方立场：委托方（保护我方利益）",
        "审查深度：快速。",
      ].join("\n"),
    });

    expect(searched).toBe(false);
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("search_workspace");
    expect(toolText).toContain(CONTRACT_FAST_LANE_DENIED_HINT.slice(0, 12));
  });
});

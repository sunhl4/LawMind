/**
 * 工具预算：步骤多少不询问律师。
 * 默认规模回合静默跑到硬顶；委派分片在自身 cap 熔断并完成，不进「待我拍板」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTurn } from "./runtime.js";
import { loadSession } from "./session.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-budget-"));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");
  return dir;
}

function baseConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    // 分片 cap 2：两轮后硬停并完成，不询问律师。
    maxToolCalls: 2,
    model: {
      provider: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "demo",
    },
  };
}

function toolCallRound(id: string) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ id, type: "function", function: { name: "peek_state", arguments: "{}" } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function finalRound(text: string) {
  return {
    choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
  };
}

function stubModelRounds(responses: unknown[]) {
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

function registryWithPeek(calls: string[]): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "peek_state",
      description: "peek",
      category: "search",
      parameters: {},
    },
    async execute() {
      calls.push("peek_state");
      return { ok: true, data: { n: calls.length } };
    },
  });
  return registry;
}

describe("silent tool-budget ceiling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("completes at a tiny cap without continue_tools", async () => {
    const workspaceDir = tmpWorkspace();
    const calls: string[] = [];
    stubModelRounds([toolCallRound("c1"), toolCallRound("c2")]);

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry: registryWithPeek(calls),
      instruction: "逐步排查这个问题",
    });

    expect(calls).toHaveLength(2);
    expect(result.turn.status).toBe("completed");
    expect(result.turn.requiresAction ?? []).toEqual([]);
    const persisted = loadSession(workspaceDir, result.sessionId);
    expect(persisted?.pendingRequiresAction ?? []).toEqual([]);
  });

  it("default-scale turns keep sampling until the model delivers, past the old ask point", async () => {
    const workspaceDir = tmpWorkspace();
    const calls: string[] = [];
    stubModelRounds([
      toolCallRound("c1"),
      toolCallRound("c2"),
      toolCallRound("c3"),
      finalRound("审查意见已写好。"),
    ]);

    const result = await runTurn({
      config: { ...baseConfig(workspaceDir), maxToolCalls: 25 },
      registry: registryWithPeek(calls),
      instruction: "逐步排查这个问题",
    });

    expect(calls).toHaveLength(3);
    expect(result.turn.status).toBe("completed");
    expect(result.reply).toBe("审查意见已写好。");
    expect(result.turn.requiresAction ?? []).toEqual([]);
  });

  it("delegation shard floor: maxToolCalls=1 circuit-breaks after one call without asking the lawyer", async () => {
    // 委派预算分片的子侧：父剩余见底时 resolveChildToolCallBudget 下限为 1，
    // 子助手硬停并完成，向父助手如实收束，不进律师「待我拍板」。
    const workspaceDir = tmpWorkspace();
    const calls: string[] = [];
    stubModelRounds([toolCallRound("c1"), toolCallRound("c2")]);

    const result = await runTurn({
      config: { ...baseConfig(workspaceDir), maxToolCalls: 1 },
      registry: registryWithPeek(calls),
      instruction: "逐步排查这个问题",
    });

    expect(calls).toHaveLength(1);
    expect(result.turn.status).toBe("completed");
    expect(result.turn.requiresAction ?? []).toEqual([]);
  });
});

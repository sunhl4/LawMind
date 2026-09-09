/**
 * 软预算检查点（continue_tools）端到端：
 * 到达软预算时 turn 以 paused 结束并产出 continue_tools 待办；
 * resume 路径（skipToolBudgetCheckpoint）不再重复询问。
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
    // 软预算 2：两轮工具调用后触发检查点；硬顶 max(2*2, 80)=80 不会先到。
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

describe("soft tool-budget checkpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pauses at the soft budget with a continue_tools requires-action", async () => {
    const workspaceDir = tmpWorkspace();
    const calls: string[] = [];
    stubModelRounds([toolCallRound("c1"), toolCallRound("c2")]);

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry: registryWithPeek(calls),
      instruction: "逐步排查这个问题",
    });

    expect(calls).toHaveLength(2);
    expect(result.turn.status).toBe("paused");
    expect(result.reply).toContain("继续");
    const action = result.turn.requiresAction?.[0];
    expect(action?.kind).toBe("continue_tools");
    expect(action?.toolCallsExecuted).toBe(2);
    expect(action?.decisions).toEqual(["approve", "reject"]);
    // 待办持久化：桌面轮询 / resumeTurn 据此恢复。
    const persisted = loadSession(workspaceDir, result.sessionId);
    expect(persisted?.pendingRequiresAction?.[0]?.kind).toBe("continue_tools");
  });

  it("skipToolBudgetCheckpoint (lawyer already continued) does not pause again", async () => {
    const workspaceDir = tmpWorkspace();
    const calls: string[] = [];
    stubModelRounds([toolCallRound("c1"), toolCallRound("c2"), finalRound("完成了。")]);

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry: registryWithPeek(calls),
      instruction: "【从检查点继续】律师同意继续本轮。",
      skipToolBudgetCheckpoint: true,
    });

    expect(calls).toHaveLength(2);
    expect(result.turn.status).toBe("completed");
    expect(result.reply).toBe("完成了。");
    expect(result.turn.requiresAction ?? []).toEqual([]);
  });

  it("delegation shard floor: maxToolCalls=1 circuit-breaks after one call and reports honestly", async () => {
    // 委派预算分片的子侧：父剩余见底时 resolveChildToolCallBudget 下限为 1，
    // 子助手（config.maxToolCalls=1）执行 1 次工具后即在软检查点熔断，
    // 如实回报「已办理 1 步」，而不是继续烧父预算。
    const workspaceDir = tmpWorkspace();
    const calls: string[] = [];
    stubModelRounds([toolCallRound("c1"), toolCallRound("c2")]);

    const result = await runTurn({
      config: { ...baseConfig(workspaceDir), maxToolCalls: 1 },
      registry: registryWithPeek(calls),
      instruction: "逐步排查这个问题",
    });

    expect(calls).toHaveLength(1);
    expect(result.turn.status).toBe("paused");
    expect(result.reply).toContain("已办理 1 步");
    expect(result.turn.requiresAction?.[0]?.kind).toBe("continue_tools");
  });
});

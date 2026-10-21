/**
 * W5 单内核：子工与主路径共用头尾截断与取消语义，保留旧实现开关。
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildReadonlyToolRegistry,
  runReadonlyWorkerLoop,
  workerLegacyLoopEnabled,
} from "./readonly-worker-loop.js";
import { callModelWithRetry } from "./runtime-model-call.js";
import { narrowWorkerToolResults, sampleUntilDone } from "./sample-until-done.js";
import type { AgentTool } from "./types.js";

vi.mock("./runtime-model-call.js", () => ({
  ModelCallUserAbortError: class ModelCallUserAbortError extends Error {
    override name = "ModelCallUserAbortError";
  },
  callModelWithRetry: vi.fn(),
}));

const workerModel = {
  provider: "openai-compatible" as const,
  model: "test",
  apiKey: "k",
  baseUrl: "http://localhost",
  contextTokens: 128_000,
};

function toolCall(name: string, args: Record<string, unknown>, id: string) {
  return {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function assistant(text: string) {
  return { choices: [{ message: { content: text }, finish_reason: "stop" }] };
}

const listDir: AgentTool = {
  definition: {
    name: "list_dir",
    description: "list",
    category: "search",
    parameters: {},
    isConcurrencySafe: true,
  },
  async execute() {
    return { ok: true, data: { entries: ["a.txt"] } };
  },
};

/** 超长中文回包：中间截断应保留头尾并标注省略量。 */
const LONG_BODY = `开头事实。${"中段材料。".repeat(3_000)}落款与签章。`;

const bigRead: AgentTool = {
  definition: {
    name: "list_dir",
    description: "list",
    category: "search",
    parameters: {},
    isConcurrencySafe: true,
  },
  async execute() {
    return { ok: true, data: { text: LONG_BODY } };
  },
};

describe("W5 worker kernel", () => {
  it("inherits cancellation from context before any model request", async () => {
    vi.mocked(callModelWithRetry).mockReset();
    const result = await sampleUntilDone({
      model: workerModel,
      maxTokens: 200,
      timeoutMs: 1000,
      temperature: 0,
      messages: [{ role: "user", content: "read" }],
      ctx: {
        workspaceDir: "/tmp",
        sessionId: "s",
        actorId: "test",
        abortSignal: AbortSignal.abort(),
      },
      allowlist: ["list_dir"],
      registry: buildReadonlyToolRegistry([listDir]),
      roleLabel: "写稿工",
      closePrompt: "done",
    });
    expect(result.aborted).toBe(true);
    expect(callModelWithRetry).not.toHaveBeenCalled();
  });

  it("narrows old worker tool results with head+tail instead of a flat slice", () => {
    const messages = [
      { role: "assistant", content: "" },
      { role: "tool", content: JSON.stringify({ ok: true, data: { text: LONG_BODY } }) },
      { role: "assistant", content: "" },
      { role: "tool", content: JSON.stringify({ ok: true, data: { text: "最近一条" } }) },
      { role: "assistant", content: "" },
      { role: "tool", content: JSON.stringify({ ok: true, data: { text: "次近一条" } }) },
    ];
    const { prunedCount } = narrowWorkerToolResults(messages, { maxTokens: 200, keepRecent: 2 });
    expect(prunedCount).toBe(1);
    const slimmed = messages[1]?.content ?? "";
    expect(slimmed).toContain("开头事实");
    expect(slimmed).toContain("落款与签章");
    expect(slimmed).toMatch(/中间省略/);
    // 最近两条保持原样。
    expect(messages[3]?.content).toContain("最近一条");
    expect(messages[5]?.content).toContain("次近一条");
  });

  it("keeps sampling past the old 5-round budget before closing", async () => {
    vi.mocked(callModelWithRetry).mockReset();
    vi.mocked(callModelWithRetry).mockImplementation(async (_cfg, _messages, tools) => {
      if (Array.isArray(tools) && tools.length > 0) {
        const n = vi.mocked(callModelWithRetry).mock.calls.length;
        return toolCall("list_dir", {}, `call_${n}`) as never;
      }
      return assistant("已完成。") as never;
    });
    const result = await sampleUntilDone({
      model: workerModel,
      maxTokens: 200,
      timeoutMs: 1_000,
      temperature: 0,
      messages: [{ role: "user", content: "读三十份材料" }],
      ctx: { workspaceDir: "/tmp", sessionId: "s1", actorId: "test" },
      allowlist: ["list_dir"],
      registry: buildReadonlyToolRegistry([listDir]),
      roleLabel: "写稿工",
      closePrompt: "收尾",
    });
    // 默认 8 轮工具轮 + 1 次强制收尾；旧实现 5 轮就会停。
    expect(result.text).toBe("已完成。");
    expect(vi.mocked(callModelWithRetry).mock.calls).toHaveLength(9);
    const lastTools = vi.mocked(callModelWithRetry).mock.calls.at(-1)?.[2] as unknown[];
    expect(lastTools).toEqual([]);
  });

  it("reads thirty distinct materials in six parallel batches and keeps the last fact", async () => {
    vi.mocked(callModelWithRetry).mockReset();
    const read: string[] = [];
    const tool: AgentTool = {
      ...listDir,
      async execute(args) {
        const name = String(args.path);
        read.push(name);
        return { ok: true, data: { text: `${name}：价款300万元；尾部事实：管辖未约定。` } };
      },
    };
    for (let round = 0; round < 6; round += 1) {
      const calls = Array.from({ length: 5 }, (_, index) => ({
        id: `read-${round * 5 + index}`,
        type: "function",
        function: {
          name: "list_dir",
          arguments: JSON.stringify({ path: `material-${round * 5 + index}.txt` }),
        },
      }));
      vi.mocked(callModelWithRetry).mockResolvedValueOnce({
        choices: [{ message: { content: "", tool_calls: calls }, finish_reason: "tool_calls" }],
      } as never);
    }
    vi.mocked(callModelWithRetry).mockResolvedValueOnce(
      assistant("30份材料已读，管辖未约定。") as never,
    );
    const result = await sampleUntilDone({
      model: workerModel,
      maxTokens: 200,
      timeoutMs: 1000,
      temperature: 0,
      messages: [{ role: "user", content: "读取30份材料" }],
      ctx: { workspaceDir: "/tmp", sessionId: "s", actorId: "test" },
      allowlist: ["list_dir"],
      registry: buildReadonlyToolRegistry([tool]),
      roleLabel: "写稿工",
      closePrompt: "收尾",
    });
    expect(new Set(read).size).toBe(30);
    expect(result.grounding).toContain("material-29.txt");
    expect(result.text).toContain("管辖未约定");
  });

  it("keeps the legacy loop switch and old 5-round budget reachable", async () => {
    expect(workerLegacyLoopEnabled({ LAWMIND_WORKER_LEGACY_LOOP: "1" })).toBe(true);
    expect(workerLegacyLoopEnabled({})).toBe(false);
    vi.stubEnv("LAWMIND_WORKER_LEGACY_LOOP", "1");
    try {
      vi.mocked(callModelWithRetry).mockReset();
      vi.mocked(callModelWithRetry).mockImplementation(async (_cfg, _messages, tools) => {
        if (Array.isArray(tools) && tools.length > 0) {
          const n = vi.mocked(callModelWithRetry).mock.calls.length;
          return toolCall("list_dir", {}, `legacy_${n}`) as never;
        }
        return assistant("旧实现收尾。") as never;
      });
      const result = await runReadonlyWorkerLoop({
        model: workerModel,
        maxTokens: 200,
        timeoutMs: 1_000,
        temperature: 0,
        messages: [{ role: "user", content: "读三十份材料" }],
        ctx: { workspaceDir: "/tmp", sessionId: "s1", actorId: "test" },
        allowlist: ["list_dir"],
        registry: buildReadonlyToolRegistry([listDir]),
        roleLabel: "写稿工",
        closePrompt: "收尾",
      });
      expect(result.text).toBe("旧实现收尾。");
      expect(vi.mocked(callModelWithRetry).mock.calls).toHaveLength(6);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("truncates a giant tool result with a token budget, not a flat char cut", async () => {
    vi.mocked(callModelWithRetry).mockReset();
    vi.mocked(callModelWithRetry)
      .mockResolvedValueOnce(toolCall("list_dir", {}, "big_1") as never)
      .mockResolvedValueOnce(assistant("读完。") as never);
    const result = await sampleUntilDone({
      // 8k 窗口 → 单条回包预算约 4k tokens，15k 字的中文回包必须头尾截断。
      model: { ...workerModel, contextTokens: 8_000 },
      maxTokens: 200,
      timeoutMs: 1_000,
      temperature: 0,
      messages: [{ role: "user", content: "读这份长材料" }],
      ctx: { workspaceDir: "/tmp", sessionId: "s1", actorId: "test" },
      allowlist: ["list_dir"],
      registry: buildReadonlyToolRegistry([bigRead]),
      roleLabel: "写稿工",
      closePrompt: "收尾",
    });
    expect(result.text).toBe("读完。");
    const toolMessage = result.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toMatch(/中间省略/);
    expect(toolMessage?.content).toContain("落款与签章");
  });
});

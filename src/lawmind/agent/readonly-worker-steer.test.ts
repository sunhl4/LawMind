import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReadonlyToolRegistry, runReadonlyWorkerLoop } from "./readonly-worker-loop.js";
import { callModelWithRetry } from "./runtime-model-call.js";
import { claimPendingSteer, peekPendingSteer, queuePendingSteer } from "./session-context-steer.js";
import type { AgentTool } from "./types.js";

vi.mock("./runtime-model-call.js", () => ({
  ModelCallUserAbortError: class ModelCallUserAbortError extends Error {
    override name = "ModelCallUserAbortError";
  },
  callModelWithRetry: vi.fn(),
}));

const listDir: AgentTool = {
  definition: {
    name: "list_dir",
    description: "list",
    category: "search",
    parameters: {},
    isConcurrencySafe: true,
  },
  async execute() {
    return { ok: true, data: { entries: [] } };
  },
};

describe("readonly worker steer", () => {
  let dir = "";

  afterEach(() => {
    vi.mocked(callModelWithRetry).mockReset();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("injects a mid-loop steer into the next sample and leaves it for the parent", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-steer-worker-"));
    const seen: string[][] = [];
    vi.mocked(callModelWithRetry).mockImplementation(async (_cfg, messages) => {
      seen.push((messages as Array<{ content?: string }>).map((message) => message.content ?? ""));
      if (seen.length === 1) {
        queuePendingSteer(dir, "s1", "不要写解除");
        return {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "list_dir", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        };
      }
      return {
        choices: [{ message: { content: "已按中途指示收束。" } }],
      };
    });

    const result = await runReadonlyWorkerLoop({
      model: {
        provider: "openai-compatible",
        model: "test",
        apiKey: "k",
        baseUrl: "http://localhost",
        contextTokens: 8_000,
      },
      maxTokens: 200,
      timeoutMs: 1_000,
      temperature: 0,
      messages: [{ role: "user", content: "审查解除权" }],
      ctx: {
        workspaceDir: dir,
        sessionId: "s1",
        actorId: "test",
      },
      allowlist: ["list_dir"],
      registry: buildReadonlyToolRegistry([listDir]),
      roleLabel: "审查工",
      closePrompt: "收束",
    });

    expect(result.aborted).toBeUndefined();
    expect(seen[0]?.join("\n")).not.toContain("不要写解除");
    expect(seen[1]?.join("\n")).toContain("【律师中途指示】");
    expect(seen[1]?.join("\n")).toContain("不要写解除");
    expect(peekPendingSteer(dir, "s1")).toEqual(["不要写解除"]);
    expect(claimPendingSteer(dir, "s1")).toEqual(["不要写解除"]);
    expect(peekPendingSteer(dir, "s1")).toEqual([]);
  });
});

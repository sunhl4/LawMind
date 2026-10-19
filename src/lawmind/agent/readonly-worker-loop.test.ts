import { describe, expect, it, vi } from "vitest";
import {
  buildReadonlyToolRegistry,
  formatSidecarProgressLabel,
  runReadonlyWorkerLoop,
  sidecarWaitLabel,
  WORKER_MODEL_WAIT_LABEL,
} from "./readonly-worker-loop.js";
import { callModelWithRetry } from "./runtime-model-call.js";
import type { AgentTool } from "./types.js";

vi.mock("./runtime-model-call.js", () => ({
  ModelCallUserAbortError: class ModelCallUserAbortError extends Error {
    override name = "ModelCallUserAbortError";
  },
  callModelWithRetry: vi.fn(),
}));

describe("sidecarWaitLabel", () => {
  it("names the hidden model wait for draft and folder workers", () => {
    expect(sidecarWaitLabel("写稿工")).toBe("正在写稿");
    expect(sidecarWaitLabel("审查工")).toBe("正在审查");
    expect(sidecarWaitLabel("探查工")).toBe("正在探查目录");
    expect(sidecarWaitLabel("助手")).toBe("正在办理");
  });
});

describe("formatSidecarProgressLabel", () => {
  it("uses lawyer-facing titles without snake_case tool ids", () => {
    const start = formatSidecarProgressLabel("list_dir", { path: "材料卷" }, "start");
    expect(start).toContain("正在");
    expect(start).toContain("材料卷");
    expect(start).not.toContain("list_dir");
    const done = formatSidecarProgressLabel("explore_folder", { path: "材料卷" }, "ok");
    expect(done.startsWith("已完成")).toBe(true);
    expect(done).not.toContain("explore_folder");
    const fail = formatSidecarProgressLabel("read_project_file", { path: "函.txt" }, "fail");
    expect(fail.startsWith("未读到")).toBe(true);
    expect(fail).not.toContain("read_project_file");
  });
});

const workerModel = {
  provider: "openai-compatible" as const,
  model: "test",
  apiKey: "k",
  baseUrl: "http://localhost",
  contextTokens: 8_000,
};

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

describe("readonly worker stop and model wait", () => {
  it("does not sample when the turn is already stopped", async () => {
    vi.mocked(callModelWithRetry).mockReset();
    const ac = new AbortController();
    ac.abort();
    const result = await runReadonlyWorkerLoop({
      model: workerModel,
      maxTokens: 200,
      timeoutMs: 1_000,
      temperature: 0,
      messages: [{ role: "user", content: "审查" }],
      ctx: { workspaceDir: "/tmp", sessionId: "s1", actorId: "test" },
      allowlist: [],
      registry: buildReadonlyToolRegistry([]),
      roleLabel: "审查工",
      closePrompt: "收束",
      abortSignal: ac.signal,
    });
    expect(result.aborted).toBe(true);
    expect(callModelWithRetry).not.toHaveBeenCalled();
  });

  it("returns stopped while an inner tool is still hanging", async () => {
    vi.mocked(callModelWithRetry).mockReset();
    vi.mocked(callModelWithRetry).mockResolvedValue({
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
    } as never);
    let started = false;
    let finish = () => undefined;
    const hanging: AgentTool = {
      ...listDir,
      execute() {
        started = true;
        return new Promise((resolve) => {
          finish = () => resolve({ ok: true, data: { entries: [] } });
        });
      },
    };
    const ac = new AbortController();
    const pending = runReadonlyWorkerLoop({
      model: workerModel,
      maxTokens: 200,
      timeoutMs: 1_000,
      temperature: 0,
      messages: [{ role: "user", content: "审查" }],
      ctx: { workspaceDir: "/tmp", sessionId: "s1", actorId: "test" },
      allowlist: ["list_dir"],
      registry: buildReadonlyToolRegistry([hanging]),
      roleLabel: "审查工",
      closePrompt: "收束",
      abortSignal: ac.signal,
    });
    const startedAt = Date.now();
    while (!started) {
      if (Date.now() - startedAt > 2_000) {
        throw new Error("tool did not start");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    ac.abort();
    const result = await pending;
    expect(result.aborted).toBe(true);
    finish();
  });

  it("shows a worker model wait on the parent progress line only", async () => {
    vi.mocked(callModelWithRetry).mockReset();
    const labels: string[] = [];
    vi.mocked(callModelWithRetry).mockImplementation(async (_cfg, _messages, _tools, opts) => {
      opts?.onAdmissionWait?.();
      opts?.onAdmissionGranted?.();
      return { choices: [{ message: { content: "已审查" } }] } as never;
    });
    await runReadonlyWorkerLoop({
      model: workerModel,
      maxTokens: 200,
      timeoutMs: 1_000,
      temperature: 0,
      messages: [{ role: "user", content: "审查" }],
      ctx: {
        workspaceDir: "/tmp",
        sessionId: "s1",
        actorId: "test",
        emitToolProgress: (label) => labels.push(label),
      },
      allowlist: [],
      registry: buildReadonlyToolRegistry([]),
      roleLabel: "审查工",
      closePrompt: "收束",
    });
    expect(labels).toContain(WORKER_MODEL_WAIT_LABEL);
    expect(labels.some((label) => label.includes("排队等模型"))).toBe(false);
    expect(vi.mocked(callModelWithRetry).mock.calls[0]?.[3]?.admission).toEqual({
      sessionId: "s1",
      kind: "worker",
    });
  });
});

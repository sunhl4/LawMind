import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_WORKER_MAX_TOOL_ROUNDS } from "./draft-worker-loop.js";
import {
  DRAFT_WORKER_DEVELOPER_INSTRUCTIONS,
  groundDraftCitations,
  parseDraftWorkerModelText,
  runDraftWorker,
} from "./draft-worker.js";
import { searchStatute } from "./tools/legal/search-tools.js";
import type { AgentModelConfig } from "./types.js";

vi.mock("../llm/http-retry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm/http-retry.js")>();
  return { ...actual, waitModelRetry: vi.fn(async () => undefined) };
});

vi.mock("./runtime-model-call.js", () => ({
  ModelCallUserAbortError: class ModelCallUserAbortError extends Error {
    override name = "ModelCallUserAbortError";
  },
  callModelWithRetry: vi.fn(),
}));

import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";

const model: AgentModelConfig = {
  provider: "openai-compatible",
  model: "test-model",
  apiKey: "k",
  baseUrl: "http://localhost",
  contextTokens: 128_000,
};

const cheap: AgentModelConfig = {
  ...model,
  model: "cheap-worker",
};

const SOURCE =
  "买卖合同约定：甲方迟延付款的，每日按应付金额万分之五计付违约金；未约定违约金上限。本合同未约定管辖法院。";

const DRAFT =
  "甲方迟延付款的，每日按应付金额万分之五计付违约金；迟延超过三十日的，乙方有权解除合同并要求赔偿因此遭受的损失。";

const completeBrief = {
  goal: "起草合同违约金条款",
  notGoal: "不要写管辖条款",
  materials: "买卖合同.docx",
  excerpt: SOURCE,
  section: "违约金",
};

function toolCallResponse(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    choices: [
      {
        message: {
          role: "assistant" as const,
          content: null,
          tool_calls: [
            {
              id,
              type: "function" as const,
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function successResponse(content: string, finishReason = "stop") {
  return {
    choices: [
      {
        message: { role: "assistant" as const, content },
        finish_reason: finishReason,
      },
    ],
  };
}

describe("parseDraftWorkerModelText", () => {
  it("reads JSON draft / citations / gaps", () => {
    const parsed = parseDraftWorkerModelText(
      JSON.stringify({
        draft: DRAFT,
        citations: ["买卖合同.docx 违约金"],
        gaps: ["违约金上限未约定"],
      }),
    );
    expect(parsed?.draft).toContain("万分之五");
    expect(parsed?.citations).toEqual(["买卖合同.docx 违约金"]);
    expect(parsed?.gaps).toEqual(["违约金上限未约定"]);
  });

  it("reads delimited 正文 / 出处 / 缺口", () => {
    const parsed = parseDraftWorkerModelText(
      ["【正文】", DRAFT, "【出处】", "- 买卖合同违约金", "【缺口】", "- 上限未约定"].join("\n"),
    );
    expect(parsed?.draft).toContain("万分之五");
    expect(parsed?.citations).toEqual(["买卖合同违约金"]);
    expect(parsed?.gaps).toEqual(["上限未约定"]);
  });

  it("falls back to prose when the model skips JSON", () => {
    const parsed = parseDraftWorkerModelText(DRAFT);
    expect(parsed?.draft).toContain("万分之五");
    expect(parsed?.gaps[0]).toContain("散文");
  });

  it("rejects empty or tiny output", () => {
    expect(parseDraftWorkerModelText("")).toBeNull();
    expect(parseDraftWorkerModelText('{ "draft": "短" }')).toBeNull();
  });
});

describe("groundDraftCitations", () => {
  it("keeps spans that appear in the source and drops invented statutes", () => {
    const grounded = groundDraftCitations(["买卖合同", "《民法典》第577条"], SOURCE);
    expect(grounded.citations).toEqual(["买卖合同"]);
    expect(grounded.dropped).toEqual(["《民法典》第577条"]);
  });
});

describe("draft-worker", () => {
  let tmp = "";

  beforeEach(() => {
    vi.mocked(callModelWithRetry).mockReset();
  });

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = "";
    }
  });

  it("rejects a vague brief without calling the model", async () => {
    const result = await runDraftWorker({ goal: "帮我看看" }, { chatModel: model });
    expect(result.ok).toBe(false);
    expect(callModelWithRetry).not.toHaveBeenCalled();
  });

  it("fails closed when the brief only names a file that is not on disk", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-empty-"));
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(JSON.stringify({ draft: DRAFT, citations: [], gaps: [] })),
    );
    const result = await runDraftWorker(
      {
        goal: "起草合同违约金条款",
        notGoal: "不要写管辖条款",
        materials: "买卖合同.docx",
        section: "违约金",
      },
      { chatModel: model, workspaceDir: tmp, sessionId: "s" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("没有可读材料");
  });

  it("fails closed when no model is configured", async () => {
    const result = await runDraftWorker(completeBrief);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("未配置写稿模型");
    expect(callModelWithRetry).not.toHaveBeenCalled();
  });

  it("prefers the primary chat model over the cheap Guardian sidecar", async () => {
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(JSON.stringify({ draft: DRAFT, citations: ["买卖合同"], gaps: [] })),
    );
    await runDraftWorker(completeBrief, { chatModel: model, reviewModel: cheap });
    const cfg = vi.mocked(callModelWithRetry).mock.calls[0]?.[0] as { model?: string };
    expect(cfg.model).toBe("test-model");
  });

  it("returns a structured draft from JSON and grounds citations", async () => {
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(
        JSON.stringify({
          draft: DRAFT,
          citations: ["买卖合同", "《民法典》第577条"],
          gaps: [],
        }),
      ),
    );
    const result = await runDraftWorker(completeBrief, { chatModel: model });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.role).toBe("draft-worker");
    expect(result.data.section).toBe("违约金");
    expect(result.data.brief).toContain("违约金");
    expect(result.data.brief).toContain("不要写管辖条款");
    expect(result.data.draft).toContain("万分之五");
    expect(result.data.citations).toEqual(["买卖合同"]);
    expect(result.data.gaps.some((g) => g.includes("民法典"))).toBe(true);
    expect(result.data.sources).toContain("excerpt");
    expect(result.data.instructions).toContain("并行写稿工");
    expect(DRAFT_WORKER_DEVELOPER_INSTRUCTIONS).toContain("禁止改原件");
    expect(callModelWithRetry).toHaveBeenCalledTimes(1);
    const cfg = vi.mocked(callModelWithRetry).mock.calls[0]?.[0] as {
      responseFormat?: { type?: string };
      maxRetries?: number;
    };
    expect(cfg.responseFormat).toBeUndefined();
    expect(cfg.maxRetries).toBe(0);
  });

  it("reads a local source file instead of trusting the filename string", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    fs.writeFileSync(path.join(tmp, "买卖合同.txt"), SOURCE, "utf8");
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(JSON.stringify({ draft: DRAFT, citations: ["买卖合同"], gaps: [] })),
    );
    const result = await runDraftWorker(
      {
        goal: "起草合同违约金条款",
        notGoal: "不要写管辖条款",
        path: "买卖合同.txt",
        section: "违约金",
      },
      { chatModel: model, workspaceDir: tmp, sessionId: "s" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.sources).toContain("买卖合同.txt");
    const advertised = vi.mocked(callModelWithRetry).mock.calls[0]?.[2] as Array<{
      function?: { name?: string };
    }>;
    expect(advertised.map((row) => row.function?.name)).toEqual(
      expect.arrayContaining(["analyze_document", "search_statute", "list_dir"]),
    );
    const user = vi.mocked(callModelWithRetry).mock.calls[0]?.[1] as Array<{ content?: string }>;
    expect(user?.[1]?.content).toContain("万分之五");
  });

  it("marks user stop as aborted", async () => {
    vi.mocked(callModelWithRetry).mockRejectedValue(new ModelCallUserAbortError());
    const result = await runDraftWorker(completeBrief, { chatModel: model });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.aborted).toBe(true);
    expect(result.error).toBe("已停止");
  });

  it("does not invent a placeholder draft when the model is empty", async () => {
    vi.mocked(callModelWithRetry).mockResolvedValue(successResponse(""));
    const result = await runDraftWorker(completeBrief, { chatModel: model });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("未返回可用正文");
    expect(result.error).not.toContain("待模型生成");
  });

  it("runs a read-only search_statute round then drafts", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-loop-"));
    const spy = vi.spyOn(searchStatute, "execute").mockResolvedValue({
      ok: true,
      data: { hits: [{ snippet: "民法典第五百八十五条 当事人可以约定违约金" }] },
    });
    vi.mocked(callModelWithRetry)
      .mockResolvedValueOnce(toolCallResponse("search_statute", { query: "违约金" }))
      .mockResolvedValueOnce(
        successResponse(
          JSON.stringify({
            draft: DRAFT,
            citations: ["买卖合同", "民法典第五百八十五条"],
            gaps: [],
          }),
        ),
      );
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "s",
    });
    spy.mockRestore();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.toolsUsed).toEqual(["search_statute"]);
    expect(result.data.citations).toEqual(
      expect.arrayContaining(["买卖合同", "民法典第五百八十五条"]),
    );
  });

  it("refuses write tools inside the worker loop and still drafts", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-deny-"));
    vi.mocked(callModelWithRetry)
      .mockResolvedValueOnce(toolCallResponse("draft_document", { title: "x" }))
      .mockResolvedValueOnce(
        successResponse(JSON.stringify({ draft: DRAFT, citations: ["买卖合同"], gaps: [] })),
      );
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "s",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.toolsUsed).toEqual([]);
    const toolMsg = vi.mocked(callModelWithRetry).mock.calls[1]?.[1] as Array<{
      role?: string;
      content?: string;
    }>;
    expect(
      toolMsg.some((row) => row.role === "tool" && String(row.content).includes("写稿工不能调用")),
    ).toBe(true);
  });

  it("forces a closing draft after the read-only tool budget", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-budget-"));
    const spy = vi.spyOn(searchStatute, "execute").mockResolvedValue({
      ok: true,
      data: { hits: [{ snippet: "民法典第五百八十五条" }] },
    });
    vi.mocked(callModelWithRetry).mockImplementation(async (_cfg, _messages, tools) => {
      if (Array.isArray(tools) && tools.length > 0) {
        const n = vi.mocked(callModelWithRetry).mock.calls.length;
        return toolCallResponse("search_statute", { query: "违约金" }, `call_${n}`);
      }
      return successResponse(JSON.stringify({ draft: DRAFT, citations: ["买卖合同"], gaps: [] }));
    });
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "s",
    });
    spy.mockRestore();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.toolsUsed).toHaveLength(DRAFT_WORKER_MAX_TOOL_ROUNDS);
    expect(vi.mocked(callModelWithRetry).mock.calls).toHaveLength(DRAFT_WORKER_MAX_TOOL_ROUNDS + 1);
    const lastTools = vi.mocked(callModelWithRetry).mock.calls.at(-1)?.[2] as unknown[];
    expect(lastTools).toEqual([]);
  });

  it("resamples once when citations fail light grounding", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-verify-"));
    vi.mocked(callModelWithRetry)
      .mockResolvedValueOnce(
        successResponse(
          JSON.stringify({
            draft: DRAFT,
            citations: ["不存在的出处XYZ"],
            gaps: [],
          }),
        ),
      )
      .mockResolvedValueOnce(
        successResponse(
          JSON.stringify({
            draft: DRAFT,
            citations: ["买卖合同"],
            gaps: [],
          }),
        ),
      );
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "s",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(vi.mocked(callModelWithRetry).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.data.steps.some((s) => s.tool === "light_verify_resample" && s.ok)).toBe(true);
    expect(result.data.citations).toContain("买卖合同");
  });
});

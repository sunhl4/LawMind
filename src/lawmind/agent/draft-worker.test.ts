import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ISOLATION_PARENT_BUDGET_CHARS,
  isolationKey,
  resetIsolationBudget,
  takeIsolationBudget,
} from "./context-isolation-budget.js";
import { DRAFT_WORKER_MAX_TOOL_ROUNDS } from "./draft-worker-loop.js";
import {
  DRAFT_WORKER_DEVELOPER_INSTRUCTIONS,
  REVIEW_WORKER_DEVELOPER_INSTRUCTIONS,
  draftWorkerSidecarConstraint,
  resolveSidecarTaskRole,
  groundDraftCitations,
  parseDraftWorkerModelText,
  runDraftWorker,
} from "./draft-worker.js";
import { loadSidecarResume } from "./sidecar-resume.js";
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
  });

  it("sidecar system gets only the 1-hop marginal and never the parent transcript", async () => {
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(
        JSON.stringify({
          draft: DRAFT,
          conclusion: "乙方有权解除",
          citations: ["买卖合同"],
          gaps: [],
        }),
      ),
    );
    const result = await runDraftWorker(
      {
        goal: "审查 clause:解除",
        notGoal: "不要改原件",
        materials: "买卖合同.docx",
        excerpt:
          "买卖合同第八条约定：逾期付款按日万分之五计付违约金。材料没有约定解除权以外的限制。",
        section: "解除",
        role: "review",
      },
      {
        chatModel: model,
        factorState: {
          factors: [
            {
              anchor: "clause:解除",
              kind: "clause",
              outcomes: [{ id: "乙方有权解除", mass: 1 }],
              repairs: 0,
              flag: "ok",
              neighbors: ["amount:wage"],
            },
            {
              anchor: "amount:wage",
              kind: "amount",
              outcomes: [{ id: "88000", mass: 1 }],
              repairs: 0,
              flag: "ok",
              neighbors: [],
            },
            {
              anchor: "clause:管辖",
              kind: "clause",
              outcomes: [{ id: "仲裁", mass: 1 }],
              repairs: 0,
              flag: "ok",
              neighbors: [],
            },
          ],
          sourcePack: [],
          demoCorpusIds: [],
          calculatedSlots: [],
          redlineFailures: [],
          lastSurgicalAnchors: [],
          adiabaticStep: 0,
        },
      },
    );
    expect(result.ok).toBe(true);
    const messages = vi.mocked(callModelWithRetry).mock.calls[0]?.[1] as Array<{
      role?: string;
      content?: string;
    }>;
    const system = messages?.find((msg) => msg.role === "system")?.content ?? "";
    const blob = messages?.map((msg) => msg.content ?? "").join("\n") ?? "";
    expect(system).toContain("【约化因子】");
    expect(system).toContain("clause:解除");
    expect(system).toContain("amount:wage");
    expect(system).not.toContain("clause:管辖");
    expect(blob).not.toContain("PARENT_SECRET_HISTORY");
    expect(blob).not.toContain("是否互相矛盾由你判断");
  });

  it("seeds 1-hop from binds even when the goal does not name the neighbor", async () => {
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(
        JSON.stringify({
          draft: DRAFT,
          conclusion: "乙方有权解除",
          citations: ["买卖合同"],
          gaps: [],
        }),
      ),
    );
    const result = await runDraftWorker(
      {
        goal: "审查解除条款",
        notGoal: "不要改原件",
        materials: "买卖合同.docx",
        excerpt:
          "买卖合同第八条约定：逾期付款按日万分之五计付违约金。材料没有约定解除权以外的限制。",
        section: "解除",
        role: "review",
        anchor: "clause:解除",
        binds: ["amount:wage"],
      },
      {
        chatModel: model,
        factorState: {
          factors: [
            {
              anchor: "clause:解除",
              kind: "clause",
              outcomes: [{ id: "乙方有权解除", mass: 1, grounded: true }],
              repairs: 0,
              flag: "ok",
              neighbors: [],
            },
            {
              anchor: "amount:wage",
              kind: "amount",
              outcomes: [{ id: "88000", mass: 1, grounded: true }],
              repairs: 0,
              flag: "ok",
              neighbors: [],
            },
            {
              anchor: "clause:管辖",
              kind: "clause",
              outcomes: [{ id: "仲裁", mass: 1, grounded: true }],
              repairs: 0,
              flag: "ok",
              neighbors: [],
            },
          ],
          sourcePack: [],
          demoCorpusIds: [],
          calculatedSlots: [],
          redlineFailures: [],
          lastSurgicalAnchors: [],
          adiabaticStep: 0,
        },
      },
    );
    expect(result.ok).toBe(true);
    const messages = vi.mocked(callModelWithRetry).mock.calls[0]?.[1] as Array<{
      role?: string;
      content?: string;
    }>;
    const system = messages?.find((msg) => msg.role === "system")?.content ?? "";
    const blob = messages?.map((msg) => msg.content ?? "").join("\n") ?? "";
    expect(system).toContain("amount:wage");
    expect(system).toContain("88000");
    expect(system).toContain("clause:解除");
    expect(system).not.toContain("clause:管辖");
    expect(blob).not.toContain("PARENT_SECRET");
  });

  it("review sidecars return a finding instead of a new clause", async () => {
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(
        JSON.stringify({
          draft:
            "合同第8条约定逾期付款按日万分之五计付违约金。材料没有约定解除权，不能据此写出解除条款。",
          conclusion: "材料未约定解除权",
          citations: ["买卖合同"],
          gaps: ["解除权未约定"],
        }),
      ),
    );
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      sidecarRole: "review",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.instructions).toBe(REVIEW_WORKER_DEVELOPER_INSTRUCTIONS);
    expect(result.data.conclusion).toBe("材料未约定解除权");
    const messages = vi.mocked(callModelWithRetry).mock.calls[0]?.[1] as Array<{
      content?: string;
    }>;
    expect(messages[0]?.content).toContain("不要起草合同条款");
    expect(messages[0]?.content).toContain("本轮工作方式");
    expect(messages[0]?.content).toContain("独立审查");
    expect(messages[1]?.content).toContain("不要写新条款");
    expect(DRAFT_WORKER_DEVELOPER_INSTRUCTIONS).toContain("禁止改原件");
    expect(callModelWithRetry).toHaveBeenCalledTimes(1);
    const cfg = vi.mocked(callModelWithRetry).mock.calls[0]?.[0] as {
      responseFormat?: { type?: string };
      maxRetries?: number;
    };
    expect(cfg.responseFormat).toBeUndefined();
    expect(cfg.maxRetries).toBe(0);
  });

  it("parent role explore returns one result and does not draft a clause", async () => {
    expect(resolveSidecarTaskRole("explore", "review")).toBe("explore");
    expect(resolveSidecarTaskRole(undefined, "review")).toBe("review");
    expect(resolveSidecarTaskRole(undefined)).toBe("draft");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    const folder = path.join(tmp, "材料");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "函.txt"), "关于催告贵司支付服务费。", "utf8");
    const result = await runDraftWorker(
      {
        goal: "看清文件夹里和催告有关的文件",
        notGoal: "不要改稿",
        path: "材料",
        role: "explore",
        section: "材料",
      },
      { workspaceDir: tmp, sessionId: "s1", projectDir: tmp },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.result).toContain("函.txt");
    expect(callModelWithRetry).not.toHaveBeenCalled();
  });

  it("locks opinion sidecars to a fragment and prefixes live progress with the section", async () => {
    expect(
      draftWorkerSidecarConstraint({
        artifactShape: "opinion_memo",
        mutateSource: "forbid",
        outputPlace: "unspecified",
        chatMirror: "unspecified",
      }),
    ).toContain("不要改原件、不要导出、不要外发");
    expect(draftWorkerSidecarConstraint(undefined)).toBe("");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    const labels: string[] = [];
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(JSON.stringify({ draft: DRAFT, citations: ["买卖合同"], gaps: [] })),
    );
    await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "s",
      deliveryIntent: {
        artifactShape: "opinion_memo",
        mutateSource: "forbid",
        outputPlace: "unspecified",
        chatMirror: "unspecified",
      },
      emitToolProgress: (label) => {
        labels.push(label);
      },
    });
    const messages = vi.mocked(callModelWithRetry).mock.calls[0]?.[1] as Array<{
      content?: string;
    }>;
    expect(messages[0]?.content).toContain("不要改原件、不要导出、不要外发");
    expect(labels.some((label) => label.startsWith("违约金 · "))).toBe(true);
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

  it("clips a long draft in the parent result and resumes the same worker", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    const long = `${"甲方迟延付款按日万分之五计付违约金。".repeat(120)}买卖合同`;
    vi.mocked(callModelWithRetry)
      .mockResolvedValueOnce(
        successResponse(JSON.stringify({ draft: long, citations: ["买卖合同"], gaps: [] })),
      )
      .mockResolvedValueOnce(
        successResponse(
          JSON.stringify({
            draft: `${DRAFT}续跑后不再写解除。`,
            conclusion: "不写解除",
            citations: ["买卖合同"],
            gaps: [],
          }),
        ),
      );
    const first = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "s1",
      sidecarRole: "review",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.data.draftClipped).toBe(true);
    expect(first.data.draft.length).toBeLessThan(long.length);
    expect(first.data.workerId).toMatch(/^w[a-f0-9]{16}$/);
    const second = await runDraftWorker(
      {
        goal: "不要写解除",
        resumeId: first.data.workerId,
        followUp: "不要写解除",
        section: "违约金",
      },
      { chatModel: model, workspaceDir: tmp, sessionId: "s1" },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.data.workerId).toBe(first.data.workerId);
    expect(second.data.conclusion).toBe("不写解除");
    const resumed = vi.mocked(callModelWithRetry).mock.calls[1]?.[1] as Array<{
      content?: string;
    }>;
    const joined = resumed.map((message) => message.content ?? "").join("\n");
    expect(joined).toContain("【续跑】不要写解除");
    expect(joined).toContain("万分之五");
  });

  it("does not leak the draft into the parent when the isolation budget is spent", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    const key = isolationKey(tmp, "budget-spent");
    resetIsolationBudget(key);
    takeIsolationBudget(key, ISOLATION_PARENT_BUDGET_CHARS);
    const long = `${"甲方迟延付款按日万分之五计付违约金。".repeat(40)}买卖合同`;
    vi.mocked(callModelWithRetry).mockResolvedValueOnce(
      successResponse(JSON.stringify({ draft: long, citations: ["买卖合同"], gaps: [] })),
    );
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "budget-spent",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.draft).toContain("配额已用完");
    expect(result.data.draft).not.toContain("万分之五");
    expect(result.data.result).toBe(result.data.draft);
    expect(result.data.conclusion).toBe("最后答复在续跑记录");
    expect(result.data.workerId).toMatch(/^w[a-f0-9]{16}$/);
    resetIsolationBudget(key);
  });

  it("keeps the resume note inside a short remainder of the budget", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    const key = isolationKey(tmp, "budget-tail");
    resetIsolationBudget(key);
    takeIsolationBudget(key, ISOLATION_PARENT_BUDGET_CHARS - 80);
    const long = `${"甲方迟延付款按日万分之五计付违约金。".repeat(40)}买卖合同`;
    vi.mocked(callModelWithRetry).mockResolvedValueOnce(
      successResponse(JSON.stringify({ draft: long, citations: ["买卖合同"], gaps: [] })),
    );
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "budget-tail",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.draft.length).toBeLessThanOrEqual(80);
    expect(result.data.draft).toContain("resume_id");
    resetIsolationBudget(key);
  });

  it("stores the light-verify rewrite in the resume transcript", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    const bad =
      "这是一段明显超过四十个字的初稿，专门用来触发轻验收，因为这条出处没有落在已读材料里面。";
    expect(bad.length).toBeGreaterThan(40);
    const fixed = `${DRAFT}轻验收已改。`;
    vi.mocked(callModelWithRetry)
      .mockResolvedValueOnce(
        successResponse(
          JSON.stringify({ draft: bad, citations: ["ZZZZ-NOT-IN-SOURCE"], gaps: [] }),
        ),
      )
      .mockResolvedValueOnce(
        successResponse(JSON.stringify({ draft: fixed, citations: ["买卖合同"], gaps: [] })),
      );
    const result = await runDraftWorker(completeBrief, {
      chatModel: model,
      workspaceDir: tmp,
      sessionId: "verify-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.workerId) {
      return;
    }
    const saved = loadSidecarResume(tmp, "verify-1", result.data.workerId);
    const joined = (saved?.messages ?? []).map((message) => message.content).join("\n");
    expect(joined).toContain("轻验收已改");
    expect(joined).not.toContain("专门用来触发轻验收");
  });

  it("explore role runs the folder sidecar and returns its summary", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-"));
    fs.writeFileSync(path.join(tmp, "买卖合同.txt"), SOURCE, "utf8");
    vi.mocked(callModelWithRetry).mockResolvedValue(
      successResponse(
        JSON.stringify({
          candidates: ["买卖合同.txt"],
          peeks: [{ path: "买卖合同.txt", excerpt: "万分之五" }],
          summary: "合同约定了违约金",
        }),
      ),
    );
    const result = await runDraftWorker(
      {
        goal: "探查违约金相关文件并摘录依据",
        path: tmp,
        role: "explore",
        section: "材料",
      },
      { chatModel: model, workspaceDir: tmp, sessionId: "explore-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(vi.mocked(callModelWithRetry).mock.calls.length).toBeGreaterThan(0);
    const sent = vi.mocked(callModelWithRetry).mock.calls[0]?.[1] as Array<{ content?: string }>;
    expect(sent.map((message) => message.content ?? "").join("\n")).toContain("探查目录");
    expect(result.data.result).toContain("合同约定了违约金");
    expect(result.data.section).toBe("材料");
    expect(result.data.workerId).toMatch(/^w[a-f0-9]{16}$/);
    expect(result.data.taskRole).toBe("explore");

    vi.mocked(callModelWithRetry).mockResolvedValueOnce(
      successResponse(
        JSON.stringify({
          candidates: ["催告.txt"],
          summary: "续跑后只看催告函",
        }),
      ),
    );
    const second = await runDraftWorker(
      {
        goal: "不要看合同",
        resumeId: result.data.workerId,
        followUp: "不要看合同，只看催告",
        section: "材料",
      },
      { chatModel: model, workspaceDir: tmp, sessionId: "explore-1" },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.data.workerId).toBe(result.data.workerId);
    expect(second.data.result).toContain("续跑后只看催告函");
    const resumed = vi.mocked(callModelWithRetry).mock.calls.at(-1)?.[1] as Array<{
      content?: string;
    }>;
    const joined = resumed.map((message) => message.content ?? "").join("\n");
    expect(joined).toContain("【续跑】不要看合同，只看催告");
    expect(joined).toContain("合同约定了违约金");
  });
});

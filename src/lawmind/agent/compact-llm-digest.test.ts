import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveClassifySidecarLimits } from "../models/capability-envelope.js";
import {
  enhanceCompactDigestWithLlm,
  isCompactLlmDigestEnabled,
  replaceDroppedDigestInMessages,
} from "./compact-llm-digest.js";
import type { AgentMessage, AgentModelConfig } from "./types.js";

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

import { callModelWithRetry } from "./runtime-model-call.js";

const LONG_SUMMARY = "律师要求审查违约金；助手建议上限改为合同总额20%；曾调用 analyze_document。";

const model: AgentModelConfig = {
  provider: "openai-compatible",
  model: "test-model",
  apiKey: "k",
  baseUrl: "http://localhost",
  contextTokens: 128_000,
};

function successResponse(content = LONG_SUMMARY, finishReason = "stop") {
  return {
    choices: [
      {
        message: { role: "assistant" as const, content },
        finish_reason: finishReason,
      },
    ],
  };
}

describe("compact-llm-digest", () => {
  beforeEach(() => {
    vi.mocked(callModelWithRetry).mockReset();
    vi.mocked(callModelWithRetry).mockResolvedValue(successResponse());
  });

  it("respects LAWMIND_COMPACT_LLM=0", () => {
    expect(isCompactLlmDigestEnabled({ LAWMIND_COMPACT_LLM: "0" } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(isCompactLlmDigestEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it("prepends 摘要： when model succeeds", async () => {
    const extractive = "【压缩前对话蒸馏】共丢弃约 2 条消息\n\n### 律师要点\n1. 审查违约金";
    const dropped: AgentMessage[] = [
      { role: "user", content: "请审查违约金条款", timestamp: "t1" },
      { role: "assistant", content: "建议改上限", timestamp: "t2" },
    ];
    const out = await enhanceCompactDigestWithLlm({
      model,
      extractiveDigest: extractive,
      dropped,
      contextTokens: 128_000,
    });
    expect(out.usedLlm).toBe(true);
    expect(out.digest).toContain("摘要：");
    expect(out.digest).toContain("20%");
    expect(callModelWithRetry).toHaveBeenCalledTimes(1);
    const cfg = vi.mocked(callModelWithRetry).mock.calls[0]?.[0] as {
      maxTokens?: number;
      maxRetries?: number;
    };
    expect(cfg.maxTokens).toBe(resolveClassifySidecarLimits({ contextTokens: 128_000 }).maxTokens);
    expect(cfg.maxRetries).toBe(0);
  });

  it("resamples a short digest then uses the next draw", async () => {
    vi.mocked(callModelWithRetry)
      .mockResolvedValueOnce(successResponse("太短"))
      .mockResolvedValueOnce(successResponse());
    const extractive = "【压缩前对话蒸馏】共丢弃约 1 条消息";
    const out = await enhanceCompactDigestWithLlm({
      model,
      extractiveDigest: extractive,
      dropped: [{ role: "user", content: "hi", timestamp: "t" }],
    });
    expect(out.usedLlm).toBe(true);
    expect(out.digest).toContain("20%");
    expect(callModelWithRetry).toHaveBeenCalledTimes(2);
  });

  it("retries transport then succeeds on the same budget", async () => {
    vi.mocked(callModelWithRetry)
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(successResponse());
    const extractive = "【压缩前对话蒸馏】共丢弃约 1 条消息";
    const out = await enhanceCompactDigestWithLlm({
      model,
      extractiveDigest: extractive,
      dropped: [{ role: "user", content: "hi", timestamp: "t" }],
    });
    expect(out.usedLlm).toBe(true);
    expect(callModelWithRetry).toHaveBeenCalledTimes(2);
  });

  it("falls back to extractive when LLM disabled", async () => {
    const prev = process.env.LAWMIND_COMPACT_LLM;
    process.env.LAWMIND_COMPACT_LLM = "0";
    try {
      const extractive = "【压缩前对话蒸馏】共丢弃约 1 条消息";
      const out = await enhanceCompactDigestWithLlm({
        model,
        extractiveDigest: extractive,
        dropped: [{ role: "user", content: "hi", timestamp: "t" }],
      });
      expect(out.usedLlm).toBe(false);
      expect(out.digest).toBe(extractive);
      expect(callModelWithRetry).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_COMPACT_LLM;
      } else {
        process.env.LAWMIND_COMPACT_LLM = prev;
      }
    }
  });

  it("replaceDroppedDigestInMessages updates first digest system note", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: "t0" },
      {
        role: "system",
        content: "【压缩前对话蒸馏】旧",
        timestamp: "t1",
      },
      { role: "user", content: "u", timestamp: "t2" },
    ];
    const next = replaceDroppedDigestInMessages(messages, "【压缩前对话蒸馏】摘要：新");
    expect(next[1]?.content).toContain("摘要：新");
    expect(next[0]?.content).toBe("sys");
  });
});

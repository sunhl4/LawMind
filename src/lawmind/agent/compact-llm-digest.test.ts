import { describe, expect, it, vi } from "vitest";
import {
  enhanceCompactDigestWithLlm,
  isCompactLlmDigestEnabled,
  replaceDroppedDigestInMessages,
} from "./compact-llm-digest.js";
import type { AgentMessage, AgentModelConfig } from "./types.js";

vi.mock("./runtime-model-call.js", () => ({
  callModelWithRetry: vi.fn(async () => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: "律师要求审查违约金；助手建议上限改为合同总额20%；曾调用 analyze_document。",
        },
      },
    ],
  })),
}));

import { callModelWithRetry } from "./runtime-model-call.js";

const model: AgentModelConfig = {
  provider: "openai-compatible",
  model: "test-model",
  apiKey: "k",
  baseUrl: "http://localhost",
  contextTokens: 128_000,
};

describe("compact-llm-digest", () => {
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
    expect(callModelWithRetry).toHaveBeenCalled();
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

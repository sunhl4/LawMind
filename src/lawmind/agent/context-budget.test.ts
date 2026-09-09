import { describe, expect, it } from "vitest";
import {
  estimateMessageTokens,
  estimateTextTokens,
  estimateTokenBudget,
} from "./context-budget.js";
import type { AgentMessage, AgentSession } from "./types.js";

function sessionWithChars(chars: number): AgentSession {
  return {
    sessionId: "s-budget",
    actorId: "lawyer",
    turns: [],
    conversationHistory: [
      {
        role: "user",
        content: "x".repeat(chars),
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("estimateTokenBudget", () => {
  it("uses model contextTokens for effectiveLimit", () => {
    const session = sessionWithChars(100);
    const small = estimateTokenBudget(session, null, { contextTokens: 32_768 });
    const large = estimateTokenBudget(session, null, { contextTokens: 131_072 });
    expect(large.effectiveLimit).toBeGreaterThan(small.effectiveLimit);
  });

  it("marks compact when usage exceeds effective limit", () => {
    // Force compact: huge message vs tiny window after reserves.
    const session = sessionWithChars(400_000);
    const budget = estimateTokenBudget(session, null, { contextTokens: 16_000 });
    expect(budget.level).toBe("compact");
  });
});

describe("estimateTextTokens (CJK-aware)", () => {
  it("counts Chinese text at ~1 token per character (not chars/4)", () => {
    const text = "合".repeat(100);
    expect(estimateTextTokens(text)).toBe(100);
  });

  it("keeps ASCII at ~4 chars per token", () => {
    expect(estimateTextTokens("x".repeat(400))).toBe(100);
  });

  it("sums CJK and ASCII segments separately for mixed text", () => {
    // 5 个 CJK 字（合同金额万）+ 5 个 ASCII（空格、数字）→ 5 + ceil(5/4)。
    expect(estimateTextTokens("合同金额 100 万")).toBe(7);
  });

  it("counts fullwidth punctuation and surrogate-pair ideographs as one token each", () => {
    expect(estimateTextTokens("，。！")).toBe(3);
    expect(estimateTextTokens("𠀀")).toBe(1);
    expect(estimateTextTokens("𠀀a")).toBe(2);
  });

  it("honors a custom charsPerToken for the non-CJK segment", () => {
    expect(estimateTextTokens("x".repeat(10), 2)).toBe(5);
    expect(estimateTextTokens("合同" + "x".repeat(10), 2)).toBe(7);
  });
});

describe("estimateMessageTokens (CJK-aware)", () => {
  it("estimates Chinese conversation history at character magnitude", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "合".repeat(100), timestamp: "t" },
      { role: "assistant", content: "x".repeat(40), timestamp: "t" },
    ];
    // 100 个汉字 ≈ 100 token + 40 ASCII ≈ 10 token；旧口径会低估为 35。
    expect(estimateMessageTokens(messages)).toBe(110);
  });
});

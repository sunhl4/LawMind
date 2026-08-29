import { describe, expect, it } from "vitest";
import { estimateTokenBudget } from "./context-budget.js";
import type { AgentSession } from "./types.js";

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

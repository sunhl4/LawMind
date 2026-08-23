import { describe, expect, it } from "vitest";
import { isContextOverflowError, pruneToolResultsInHistory } from "./session-tool-result-prune.js";
import type { AgentMessage } from "./types.js";

function toolMsg(content: string, extra?: Partial<AgentMessage>): AgentMessage {
  return {
    role: "tool",
    content,
    timestamp: new Date().toISOString(),
    toolCallResponses: [
      {
        toolCallId: "c1",
        name: "research_task",
        result: { ok: true, data: { text: "x".repeat(20_000) } },
      },
    ],
    ...extra,
  };
}

describe("session-tool-result-prune", () => {
  it("detects common provider overflow wording", () => {
    expect(isContextOverflowError(new Error("context_length_exceeded"))).toBe(true);
    expect(isContextOverflowError(new Error("This model's maximum context length is 128000"))).toBe(
      true,
    );
    expect(isContextOverflowError(new Error("上下文过长，请压缩后重试"))).toBe(true);
    expect(isContextOverflowError(new Error("rate limit"))).toBe(false);
  });

  it("shrinks tool results but keeps user/assistant and pairing", () => {
    const huge = JSON.stringify({ ok: true, text: "y".repeat(30_000) });
    const messages: AgentMessage[] = [
      { role: "user", content: "请检索", timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        toolCalls: [{ id: "c1", name: "research_task", arguments: {} }],
      },
      toolMsg(huge),
    ];
    const out = pruneToolResultsInHistory(messages, { maxChars: 2_000 });
    expect(out.prunedCount).toBe(1);
    expect(out.charsRemoved).toBeGreaterThan(0);
    expect(out.messages).toHaveLength(3);
    expect(out.messages[0]?.role).toBe("user");
    expect(out.messages[1]?.toolCalls?.[0]?.id).toBe("c1");
    expect(out.messages[2]?.role).toBe("tool");
    expect(out.messages[2]?.content.length ?? 0).toBeLessThan(huge.length);
    expect(out.messages[2]?.toolCallResponses?.[0]?.toolCallId).toBe("c1");
  });

  it("is a no-op when nothing is over budget", () => {
    const messages: AgentMessage[] = [
      {
        role: "tool",
        content: JSON.stringify({ ok: true, text: "short" }),
        timestamp: new Date().toISOString(),
      },
    ];
    const out = pruneToolResultsInHistory(messages, { maxChars: 2_000 });
    expect(out.prunedCount).toBe(0);
    expect(out.messages[0]).toBe(messages[0]);
  });
});

import { describe, expect, it } from "vitest";
import {
  findUnpairedToolCallIds,
  repairToolCallPairing,
  TOOL_CALL_PAIRING_PLACEHOLDER_ERROR,
} from "./session-tool-call-pairing.js";
import type { AgentMessage } from "./types.js";

function assistantWithCalls(ids: string[]): AgentMessage {
  return {
    role: "assistant",
    content: "",
    toolCalls: ids.map((id) => ({ id, name: `tool_${id}`, arguments: {} })),
    timestamp: "t",
  };
}

function toolResponse(id: string): AgentMessage {
  return {
    role: "tool",
    content: JSON.stringify({ ok: true }),
    toolCallResponses: [{ toolCallId: id, name: `tool_${id}`, result: { ok: true } }],
    timestamp: "t",
  };
}

describe("findUnpairedToolCallIds", () => {
  it("returns empty when every tool_call has a paired tool message", () => {
    const history = [
      assistantWithCalls(["a", "b"]),
      toolResponse("a"),
      toolResponse("b"),
      { role: "assistant", content: "完成", timestamp: "t" } as AgentMessage,
    ];
    expect(findUnpairedToolCallIds(history)).toEqual([]);
  });

  it("flags tool_calls without a paired tool message", () => {
    const history = [assistantWithCalls(["a", "b"]), toolResponse("a")];
    expect(findUnpairedToolCallIds(history)).toEqual(["b"]);
  });

  it("flags calls when a user message intervenes before any tool response", () => {
    const history = [
      assistantWithCalls(["a"]),
      { role: "user", content: "等等", timestamp: "t" } as AgentMessage,
    ];
    expect(findUnpairedToolCallIds(history)).toEqual(["a"]);
  });
});

describe("repairToolCallPairing", () => {
  it("is a no-op (same array contents, no repairs) for paired history", () => {
    const history = [assistantWithCalls(["a"]), toolResponse("a")];
    const repaired = repairToolCallPairing(history);
    expect(repaired.repairedToolCallIds).toEqual([]);
    expect(repaired.messages).toEqual(history);
  });

  it("inserts a placeholder tool message after existing responses for dangling calls", () => {
    const history = [assistantWithCalls(["a", "b"]), toolResponse("a")];
    const repaired = repairToolCallPairing(history);
    expect(repaired.repairedToolCallIds).toEqual(["b"]);
    expect(repaired.messages.map((m) => m.role)).toEqual(["assistant", "tool", "tool"]);
    const placeholder = repaired.messages[2];
    expect(placeholder?.toolCallResponses?.[0]?.toolCallId).toBe("b");
    expect(placeholder?.toolCallResponses?.[0]?.result.ok).toBe(false);
    expect(placeholder?.toolCallResponses?.[0]?.result.error).toBe(
      TOOL_CALL_PAIRING_PLACEHOLDER_ERROR,
    );
    // 修复后的序列自身不再有悬空调用。
    expect(findUnpairedToolCallIds(repaired.messages)).toEqual([]);
    // 原数组不被修改。
    expect(history).toHaveLength(2);
  });

  it("repairs dangling calls from an older turn mid-history", () => {
    const history = [
      assistantWithCalls(["old1", "old2"]),
      toolResponse("old1"),
      { role: "user", content: "新指令", timestamp: "t" } as AgentMessage,
      assistantWithCalls(["new1"]),
      toolResponse("new1"),
    ];
    const repaired = repairToolCallPairing(history);
    expect(repaired.repairedToolCallIds).toEqual(["old2"]);
    // 占位消息紧跟该 assistant 的已有 tool 响应之后、下一条 user 之前。
    expect(repaired.messages.map((m) => m.role)).toEqual([
      "assistant",
      "tool",
      "tool",
      "user",
      "assistant",
      "tool",
    ]);
    expect(findUnpairedToolCallIds(repaired.messages)).toEqual([]);
  });
});

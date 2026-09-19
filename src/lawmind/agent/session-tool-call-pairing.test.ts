import { describe, expect, it } from "vitest";
import {
  alignCutIndexToToolGroups,
  findUnpairedToolCallIds,
  hasOpenToolGroup,
  isToolPairingRejectText,
  normalizeToolResultMessages,
  repairToolCallPairing,
  sanitizeWireMessages,
  sliceKeepingToolGroups,
  TOOL_CALL_PAIRING_PLACEHOLDER_ERROR,
  TOOL_GROUP_CUT_LOOKBACK,
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

function userMsg(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: "t" };
}

/** OpenAI 兼容接口的送出自检：tool 消息是否落在对应 tool_calls 的组外。 */
function hasOrphanToolResult(messages: AgentMessage[]): boolean {
  let open: Set<string> | null = null;
  for (const msg of messages) {
    if (msg.role === "tool") {
      const id = msg.toolCallResponses?.[0]?.toolCallId ?? "";
      if (!open || !open.has(id)) {
        return true;
      }
      open.delete(id);
      continue;
    }
    open =
      msg.role === "assistant" && (msg.toolCalls?.length ?? 0) > 0
        ? new Set(msg.toolCalls!.map((tc) => tc.id))
        : null;
  }
  return false;
}

describe("normalizeToolResultMessages", () => {
  it("is a no-op for already-paired history", () => {
    const history = [assistantWithCalls(["a", "b"]), toolResponse("a"), toolResponse("b")];
    const out = normalizeToolResultMessages(history);
    expect(out.changed).toBe(false);
    expect(out.droppedToolCallIds).toEqual([]);
    expect(out.messages).toBe(history);
  });

  it("drops an orphan tool result whose call was compacted away (DeepSeek 400)", () => {
    const history = [
      userMsg("问"),
      { role: "assistant", content: "答", timestamp: "t" } as AgentMessage,
      toolResponse("gone"),
      assistantWithCalls(["live"]),
      toolResponse("live"),
    ];
    const out = normalizeToolResultMessages(history);
    expect(out.droppedToolCallIds).toEqual(["gone"]);
    expect(out.changed).toBe(true);
    expect(hasOrphanToolResult(out.messages)).toBe(false);
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant", "tool"]);
  });

  it("relocates a still-matching result back under its call", () => {
    const history = [assistantWithCalls(["a"]), userMsg("插话"), toolResponse("a")];
    const out = normalizeToolResultMessages(history);
    expect(out.relocatedToolCallIds).toEqual(["a"]);
    expect(out.messages.map((m) => m.role)).toEqual(["assistant", "tool", "user"]);
    expect(hasOrphanToolResult(out.messages)).toBe(false);
  });

  it("drops a duplicated result for an already-answered call", () => {
    const history = [assistantWithCalls(["a"]), toolResponse("a"), toolResponse("a")];
    const out = normalizeToolResultMessages(history);
    expect(out.droppedToolCallIds).toEqual(["a"]);
    expect(out.messages.map((m) => m.role)).toEqual(["assistant", "tool"]);
  });
});

describe("alignCutIndexToToolGroups", () => {
  it("leaves a cut outside a tool group untouched", () => {
    const messages = [userMsg("u"), assistantWithCalls(["a"]), toolResponse("a")];
    expect(alignCutIndexToToolGroups(messages, 0)).toBe(0);
    expect(alignCutIndexToToolGroups(messages, 1)).toBe(1);
    expect(alignCutIndexToToolGroups(messages, messages.length)).toBe(messages.length);
  });

  it("pulls the cut back to the owning assistant when it lands mid-group", () => {
    const messages = [
      userMsg("u1"),
      assistantWithCalls(["a", "b"]),
      toolResponse("a"),
      toolResponse("b"),
      userMsg("u2"),
    ];
    expect(alignCutIndexToToolGroups(messages, 2)).toBe(1);
    expect(alignCutIndexToToolGroups(messages, 3)).toBe(1);
  });

  it("skips past an oversized group instead of keeping a partial one", () => {
    const ids = Array.from({ length: TOOL_GROUP_CUT_LOOKBACK + 4 }, (_, i) => `c${i}`);
    const messages = [assistantWithCalls(ids), ...ids.map((id) => toolResponse(id))];
    expect(alignCutIndexToToolGroups(messages, messages.length - 1)).toBe(messages.length);
  });
});

describe("sliceKeepingToolGroups", () => {
  it("keeps the whole tool group when the tail cut lands mid-group", () => {
    const messages = [
      userMsg("u1"),
      { role: "assistant", content: "a0", timestamp: "t" } as AgentMessage,
      userMsg("u2"),
      assistantWithCalls(["a"]),
      toolResponse("a"),
      userMsg("u3"),
    ];
    const { kept, dropped } = sliceKeepingToolGroups(messages, 2);
    expect(kept.map((m) => m.role)).toEqual(["assistant", "tool", "user"]);
    expect(dropped).toHaveLength(3);
    expect(hasOrphanToolResult(kept)).toBe(false);
  });

  it("returns everything when the keep count already covers the slice", () => {
    const messages = [userMsg("u"), assistantWithCalls(["a"]), toolResponse("a")];
    const { kept, dropped } = sliceKeepingToolGroups(messages, 5);
    expect(kept).toEqual(messages);
    expect(dropped).toEqual([]);
  });
});

describe("hasOpenToolGroup", () => {
  it("is false once every call in the group is answered", () => {
    expect(
      hasOpenToolGroup([assistantWithCalls(["a", "b"]), toolResponse("a"), toolResponse("b")]),
    ).toBe(false);
  });

  it("is true while results are still arriving (batch in flight)", () => {
    expect(hasOpenToolGroup([assistantWithCalls(["a", "b"]), toolResponse("a")])).toBe(true);
  });

  it("is true when the batch has not produced any result yet", () => {
    expect(hasOpenToolGroup([userMsg("go"), assistantWithCalls(["a"])])).toBe(true);
  });

  it("is false when the tail is a plain user or assistant message", () => {
    expect(hasOpenToolGroup([assistantWithCalls(["a"]), toolResponse("a"), userMsg("next")])).toBe(
      false,
    );
    expect(
      hasOpenToolGroup([
        assistantWithCalls(["a"]),
        toolResponse("a"),
        { role: "assistant", content: "done", timestamp: "t" } as AgentMessage,
      ]),
    ).toBe(false);
  });
});

function wireAssistant(ids: string[]) {
  return {
    role: "assistant",
    content: "",
    tool_calls: ids.map((id) => ({
      id,
      type: "function",
      function: { name: `tool_${id}`, arguments: "{}" },
    })),
  };
}

function wireTool(id: string) {
  return { role: "tool", content: "{}", tool_call_id: id };
}

describe("sanitizeWireMessages", () => {
  it("is a no-op for a paired wire history", () => {
    const messages = [wireAssistant(["a"]), wireTool("a")];
    const out = sanitizeWireMessages(messages);
    expect(out.changed).toBe(false);
    expect(out.repairedToolCallIds).toEqual([]);
    expect(out.droppedToolCallIds).toEqual([]);
  });

  it("drops an orphan wire result that has no matching call", () => {
    const messages = [
      { role: "user", content: "先看看" },
      wireTool("gone"),
      wireAssistant(["live"]),
      wireTool("live"),
    ];
    const out = sanitizeWireMessages(messages);
    expect(out.droppedToolCallIds).toEqual(["gone"]);
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("inserts a synthetic result for a call that never got one", () => {
    const messages = [wireAssistant(["a", "b"]), wireTool("a")];
    const out = sanitizeWireMessages(messages);
    expect(out.repairedToolCallIds).toEqual(["b"]);
    const synthetic = out.messages[2];
    expect(synthetic?.tool_call_id).toBe("b");
    expect(synthetic?.content ?? "").toContain("已取消");
  });

  it("relocates a still-matching result back under its call", () => {
    const messages = [wireAssistant(["a"]), { role: "user", content: "插话" }, wireTool("a")];
    const out = sanitizeWireMessages(messages);
    expect(out.messages.map((m) => m.role)).toEqual(["assistant", "tool", "user"]);
  });

  it("drops a duplicated result for an already-answered call", () => {
    const messages = [wireAssistant(["a"]), wireTool("a"), wireTool("a")];
    const out = sanitizeWireMessages(messages);
    expect(out.droppedToolCallIds).toEqual(["a"]);
    expect(out.messages.map((m) => m.role)).toEqual(["assistant", "tool"]);
  });
});

describe("isToolPairingRejectText", () => {
  it("matches the DeepSeek 400 body seen in the field", () => {
    const body = JSON.stringify({
      error: {
        message:
          "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
        type: "invalid_request_error",
        param: null,
        code: "invalid_request_error",
      },
    });
    expect(isToolPairingRejectText(body)).toBe(true);
  });

  it("matches Anthropic tool_result wording", () => {
    expect(
      isToolPairingRejectText(
        "unexpected `tool_use_id` found in `tool_result` blocks: toolu_x. Each `tool_result` block must have a corresponding `tool_use` block in the previous message.",
      ),
    ).toBe(true);
  });

  it("does not match unrelated 400s", () => {
    expect(
      isToolPairingRejectText(
        '{"error":{"message":"Invalid temperature","type":"invalid_request_error"}}',
      ),
    ).toBe(false);
    expect(isToolPairingRejectText("max_tokens is too large")).toBe(false);
  });
});

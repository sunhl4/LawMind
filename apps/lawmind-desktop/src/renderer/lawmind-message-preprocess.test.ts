import { describe, expect, it } from "vitest";
import { preprocessChatMessages } from "./lawmind-message-preprocess";
import type { ChatMsg } from "./lawmind-chat";

function assistant(partial: Partial<ChatMsg> = {}): ChatMsg {
  return { role: "assistant", text: "ok", ...partial };
}

function user(text: string): ChatMsg {
  return { role: "user", text };
}

describe("preprocessChatMessages", () => {
  it("returns one item per message by default", () => {
    const items = preprocessChatMessages([user("hi"), assistant()]);
    expect(items.filter((i) => i.kind === "message")).toHaveLength(2);
  });

  it("promotes pending clarification assistant to front", () => {
    const messages = [
      user("a"),
      assistant({ text: "need info", status: "awaiting_clarification" }),
    ];
    const items = preprocessChatMessages(messages);
    const first = items[0];
    expect(first?.kind).toBe("message");
    if (first?.kind === "message") {
      expect(first.message.status).toBe("awaiting_clarification");
    }
  });

  it("brief mode keeps deliverable-related turns", () => {
    const messages = [
      user("hello"),
      assistant({ text: "chat", toolCallSequence: [] }),
      assistant({ text: "draft", toolCallSequence: ["draft_document"] }),
    ];
    const items = preprocessChatMessages(messages, { briefOnly: true });
    const indices = items
      .filter((i) => i.kind === "message")
      .map((i) => (i.kind === "message" ? i.sourceIndex : -1));
    expect(indices).toContain(2);
  });
});

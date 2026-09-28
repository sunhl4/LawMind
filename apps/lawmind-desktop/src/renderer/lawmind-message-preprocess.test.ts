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

  it("folds one question's status bubbles into the latest answer", () => {
    const items = preprocessChatMessages([
      user("清理文件"),
      assistant({ text: "先盘清家底再动手。" }),
      assistant({ text: "先把完整清单读全，再分类。" }),
      assistant({ text: "清理完成。不需要的已集中到待删除。" }),
    ]);
    const answers = items.filter((item) => item.kind === "message" && item.message.role === "assistant");
    expect(answers).toHaveLength(1);
    const answer = answers[0];
    if (answer?.kind !== "message") {
      throw new Error("expected one assistant bubble");
    }
    expect(answer.message.text).toBe("清理完成。不需要的已集中到待删除。");
    expect(answer.message.liveTrace).toBeUndefined();
  });

  it("hides compact digests and strips tool inventory from lawyer bubbles", () => {
    const items = preprocessChatMessages([
      user("清理文件"),
      user(
        "【压缩后上下文锚点】\n- 交付物验收与 render 门禁仍须遵守当前草稿 acceptance 状态。",
      ),
      assistant({
        text: "清理完成。\n\n### 曾调用工具\nanalyze_document, run_host_command, write_document",
      }),
    ]);
    const texts = items
      .filter((item): item is Extract<typeof item, { kind: "message" }> => item.kind === "message")
      .map((item) => item.message.text);
    expect(texts).toEqual(["清理文件", "清理完成。"]);
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

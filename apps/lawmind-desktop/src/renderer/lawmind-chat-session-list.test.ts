import { describe, expect, it } from "vitest";
import {
  lawyerChatListTitle,
  mergeChatSessionListRefresh,
  previewTitleFromUtterance,
  retitlePlaceholderChatSession,
  upsertChatSessionAtFront,
} from "./lawmind-chat-session-list";

describe("lawyer chat list titles", () => {
  it("shows the lawyer-facing name for a brand new chat", () => {
    expect(lawyerChatListTitle("New Chat")).toBe("新对话");
    expect(lawyerChatListTitle("")).toBe("新对话");
    expect(lawyerChatListTitle("法考计划")).toBe("法考计划");
  });

  it("previews the first sentence so the sidebar can rename before the turn ends", () => {
    expect(previewTitleFromUtterance("我想要去法考请你帮我设置计划。先看大纲。")).toBe(
      "我想要去法考请你帮我设置计划。",
    );
  });

  it("keeps a sentence the lawyer already sent when the catalog still says 新对话", () => {
    const previous = [
      { sessionId: "fresh", title: "我想要去法考请你帮我设置计划。", updatedAt: "2" },
      { sessionId: "old", title: "旧对话", updatedAt: "1" },
    ];
    const incoming = [
      { sessionId: "fresh", title: "新对话", updatedAt: "3" },
      { sessionId: "old", title: "旧对话", updatedAt: "1" },
    ];
    expect(mergeChatSessionListRefresh(previous, incoming).map((row) => row.title)).toEqual([
      "我想要去法考请你帮我设置计划。",
      "旧对话",
    ]);
  });

  it("inserts the new chat at the top and does not wipe a live title", () => {
    const withSentence = upsertChatSessionAtFront(
      [{ sessionId: "fresh", title: "我想要去法考请你帮我设置计划。", updatedAt: "2" }],
      { sessionId: "fresh", title: "新对话", updatedAt: "3" },
    );
    expect(withSentence[0]?.title).toBe("我想要去法考请你帮我设置计划。");
    expect(
      retitlePlaceholderChatSession(
        [{ sessionId: "old", title: "旧对话", updatedAt: "1" }],
        "fresh",
        "帮我列法考计划。",
        { matterId: "m-1" },
      ).map((row) => row.sessionId),
    ).toEqual(["fresh", "old"]);
  });
});

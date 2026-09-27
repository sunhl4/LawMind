import { describe, expect, it } from "vitest";
import {
  chatScopeForMatterId,
  contextMatterIdAfterCatalogChange,
  countUnboundChatSessions,
  inferInitialChatScope,
  isSessionInChatScope,
  pickChatSessionForScope,
} from "./lawmind-chat-scope";
import type { ChatSessionListEntry } from "./lawmind-chat-active-storage";

function row(
  partial: Partial<ChatSessionListEntry> & Pick<ChatSessionListEntry, "sessionId">,
): ChatSessionListEntry {
  return {
    title: partial.sessionId,
    updatedAt: partial.updatedAt ?? "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

describe("chatScopeForMatterId", () => {
  const known = new Set(["甲案"]);

  it("空案件号是未归案", () => {
    expect(chatScopeForMatterId(null, known)).toBeNull();
    expect(chatScopeForMatterId("  ", known)).toBeNull();
  });

  it("目录里没有的案件号在目录加载后归入未归案", () => {
    expect(chatScopeForMatterId("已删", known)).toBeNull();
    expect(chatScopeForMatterId("已删", null)).toBe("已删");
  });
});

describe("contextMatterIdAfterCatalogChange", () => {
  it("只在这一卷从已加载的目录里消失时解开", () => {
    const before = new Set(["甲案", "空壳"]);
    const after = new Set(["甲案"]);
    expect(contextMatterIdAfterCatalogChange("空壳", before, after)).toBeNull();
    expect(contextMatterIdAfterCatalogChange("甲案", before, after)).toBe("甲案");
    expect(contextMatterIdAfterCatalogChange("刚建", before, after)).toBe("刚建");
    expect(contextMatterIdAfterCatalogChange("空壳", null, after)).toBe("空壳");
  });
});

describe("pickChatSessionForScope", () => {
  const known = new Set(["甲案", "乙案"]);
  const sessions = [
    row({ sessionId: "old", matterId: "甲案", assistantId: "合同", updatedAt: "2026-09-01T00:00:00.000Z" }),
    row({ sessionId: "new", matterId: "甲案", assistantId: "诉讼", updatedAt: "2026-09-02T00:00:00.000Z" }),
    row({ sessionId: "free", matterId: undefined, assistantId: "合同", updatedAt: "2026-09-03T00:00:00.000Z" }),
    row({ sessionId: "gone", matterId: "已删", assistantId: "合同", updatedAt: "2026-09-04T00:00:00.000Z" }),
  ];

  it("某一案只打开该案里记住的那场，没有则打开最近一场", () => {
    expect(pickChatSessionForScope(sessions, "甲案", known)?.sessionId).toBe("new");
    expect(
      pickChatSessionForScope(sessions, "甲案", known, { storedSessionId: "old" })?.sessionId,
    ).toBe("old");
  });

  it("指定助手时不打开另一助手的最近一场", () => {
    expect(
      pickChatSessionForScope(sessions, "甲案", known, { assistantId: "合同" })?.sessionId,
    ).toBe("old");
    expect(pickChatSessionForScope(sessions, "甲案", known, { assistantId: "没有" })).toBeUndefined();
  });

  it("未归案包含没绑案的和案件已不在的，空档不选出对话", () => {
    expect(pickChatSessionForScope(sessions, null, known)?.sessionId).toBe("gone");
    expect(countUnboundChatSessions(sessions, known)).toBe(2);
    expect(isSessionInChatScope(sessions[0], null, known)).toBe(false);
    expect(pickChatSessionForScope(sessions, "乙案", known)).toBeUndefined();
  });
});

describe("inferInitialChatScope", () => {
  it("用上次打开的那场对话所在的档，而不是一律未归案", () => {
    const sessions = [
      row({ sessionId: "a", matterId: "甲案", updatedAt: "2026-09-02T00:00:00.000Z" }),
      row({ sessionId: "b", updatedAt: "2026-09-03T00:00:00.000Z" }),
    ];
    expect(inferInitialChatScope(sessions, "a", new Set(["甲案"]))).toBe("甲案");
    expect(inferInitialChatScope(sessions, undefined, new Set(["甲案"]))).toBeNull();
  });
});

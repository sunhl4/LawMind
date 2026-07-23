import { describe, expect, it } from "vitest";
import {
  buildFileContextMessagePrefix,
  fileChatScopeKey,
  isFileChatExcerptCandidate,
  makeFileContextItemId,
  migratePendingFileChatPins,
  type FileChatContextItem,
} from "./lawmind-file-chat-context.ts";

describe("fileChatScopeKey", () => {
  it("isolates assistant and session", () => {
    expect(fileChatScopeKey({ assistantId: "a1", sessionId: "s1" })).toBe("a1::s1");
    expect(fileChatScopeKey({ assistantId: "a1", sessionId: "s2" })).not.toBe(
      fileChatScopeKey({ assistantId: "a1", sessionId: "s1" }),
    );
    expect(fileChatScopeKey({ assistantId: "a2", sessionId: "s1" })).not.toBe(
      fileChatScopeKey({ assistantId: "a1", sessionId: "s1" }),
    );
  });

  it("uses pending bucket when session is missing", () => {
    expect(fileChatScopeKey({ assistantId: "a1", sessionId: null })).toBe("a1::__pending__");
    expect(fileChatScopeKey({ assistantId: "a1" })).toBe("a1::__pending__");
  });
});

describe("migratePendingFileChatPins", () => {
  const pin = (relPath: string): FileChatContextItem => ({
    id: makeFileContextItemId({ root: "workspace", relPath, kind: "file" }),
    root: "workspace",
    relPath,
    kind: "file",
  });

  it("moves pending pins into the real session when empty", () => {
    const pending = [pin("a.md")];
    const next = migratePendingFileChatPins(
      { "default::__pending__": pending },
      { assistantId: "default", sessionId: "sess-1" },
    );
    expect(next["default::__pending__"]).toBeUndefined();
    expect(next["default::sess-1"]).toEqual(pending);
  });

  it("drops pending when the session already has pins", () => {
    const pending = [pin("old.md")];
    const existing = [pin("keep.md")];
    const next = migratePendingFileChatPins(
      { "default::__pending__": pending, "default::sess-1": existing },
      { assistantId: "default", sessionId: "sess-1" },
    );
    expect(next["default::__pending__"]).toBeUndefined();
    expect(next["default::sess-1"]).toEqual(existing);
  });

  it("is a no-op without a session id", () => {
    const map = { "default::__pending__": [pin("a.md")] };
    expect(migratePendingFileChatPins(map, { assistantId: "default", sessionId: null })).toBe(map);
  });
});

describe("file chat excerpts", () => {
  it("detects textish excerpt candidates", () => {
    expect(
      isFileChatExcerptCandidate({
        id: "1",
        root: "workspace",
        relPath: "notes/memo.md",
        kind: "file",
      }),
    ).toBe(true);
    expect(
      isFileChatExcerptCandidate({
        id: "2",
        root: "workspace",
        relPath: "scan.pdf",
        kind: "file",
      }),
    ).toBe(false);
    expect(
      isFileChatExcerptCandidate({
        id: "3",
        root: "workspace",
        relPath: "folder",
        kind: "directory",
      }),
    ).toBe(false);
  });

  it("embeds excerpt bodies and labels path-only refs", () => {
    const item: FileChatContextItem = {
      id: makeFileContextItemId({ root: "workspace", relPath: "a.md", kind: "file" }),
      root: "workspace",
      relPath: "a.md",
      kind: "file",
    };
    const withBody = buildFileContextMessagePrefix([item], { [item.id]: "合同正文摘录" });
    expect(withBody).toContain("已嵌入正文");
    expect(withBody).toContain("合同正文摘录");
    const pathOnly = buildFileContextMessagePrefix([item]);
    expect(pathOnly).toContain("路径引用");
    expect(pathOnly).not.toContain("已嵌入正文");
  });
});

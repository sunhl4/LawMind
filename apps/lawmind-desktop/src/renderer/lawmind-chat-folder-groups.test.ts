import { describe, expect, it } from "vitest";
import {
  groupSideChatSessions,
  sideChatAgeLabel,
  sideChatFolderHoverMeta,
  sideChatFolderTitle,
  workspaceFolderName,
} from "./lawmind-chat-folder-groups";

describe("sideChatFolderHoverMeta", () => {
  const now = Date.parse("2026-10-16T03:00:00.000Z");

  it("counts chats and shows how recent the newest one is", () => {
    expect(sideChatAgeLabel("2026-10-16T02:55:00.000Z", now)).toBe("5 分");
    expect(sideChatAgeLabel(undefined, now)).toBeNull();
    expect(
      sideChatFolderHoverMeta(
        [{ updatedAt: "2026-10-16T02:00:00.000Z" }, { updatedAt: "2026-10-16T02:55:00.000Z" }],
        now,
      ),
    ).toBe("2 场 · 5 分");
  });

  it("uses the local folder path as the hover title", () => {
    expect(
      sideChatFolderTitle({
        label: "YX",
        folder: true,
        workspace: true,
        workspaceFolderPath: "/Users/shl/nvidia/YX",
      }),
    ).toBe("/Users/shl/nvidia/YX");
    expect(
      sideChatFolderTitle({
        label: "非技术相关",
        folder: true,
        workspaceFolderPath: "/Users/shl/nvidia/YX",
      }),
    ).toBe("/Users/shl/nvidia/YX/非技术相关");
  });
});

describe("workspaceFolderName", () => {
  it("uses the last segment of the local folder", () => {
    expect(workspaceFolderName("/Users/shl/nvidia/YX")).toBe("YX");
    expect(workspaceFolderName("")).toBeNull();
    expect(workspaceFolderName(null)).toBeNull();
  });
});

describe("groupSideChatSessions", () => {
  it("puts unbound chats first and nests a folder's chats under that folder", () => {
    const groups = groupSideChatSessions(
      [
        { sessionId: "a", title: "诉讼时效", folderRel: null },
        { sessionId: "b", title: "审查合同", folderRel: "甲案/合同" },
        { sessionId: "c", title: "开庭", folderRel: "甲案" },
        { sessionId: "d", title: "仲裁", folderRel: "乙案" },
      ],
      {},
    );
    expect(groups.map((group) => group.label)).toEqual([null, "甲案", "乙案"]);
    expect(groups.map((group) => group.folder)).toEqual([false, true, true]);
    expect(groups[1]?.sessions.map((row) => row.sessionId)).toEqual(["b", "c"]);
  });

  it("keeps an older matter-only chat under the matter name", () => {
    const groups = groupSideChatSessions(
      [{ sessionId: "m", title: "旧对话", matterId: "m1" }],
      { matterTitleById: { m1: "借贷案" }, knownMatterIds: new Set(["m1"]) },
    );
    expect(groups).toEqual([
      {
        key: "matter:m1",
        label: "借贷案",
        folder: false,
        sessions: [{ sessionId: "m", title: "旧对话", matterId: "m1" }],
      },
    ]);
  });

  it("keeps an older unbound chat out of a workspace that was bound later", () => {
    const groups = groupSideChatSessions([
      { sessionId: "old", title: "旧对话" },
      { sessionId: "fresh", title: "新对话", workDir: "/Users/shl/nvidia/YX" },
      { sessionId: "kept", title: "已绑定", folderRel: "甲案" },
    ]);
    expect(groups.map((group) => [group.label, group.workDir ?? null])).toEqual([
      ["YX", "/Users/shl/nvidia/YX"],
      [null, null],
      ["甲案", null],
    ]);
    expect(groups[0]?.sessions.map((row) => row.sessionId)).toEqual(["fresh"]);
    expect(groups[1]?.sessions.map((row) => row.sessionId)).toEqual(["old"]);
    expect(groups[2]?.sessions.map((row) => row.sessionId)).toEqual(["kept"]);
  });
});

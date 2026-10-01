import { describe, expect, it } from "vitest";
import {
  matchSyncedLawyerHunks,
  popSyncedLawyerUndo,
  pushSyncedLawyerUndo,
} from "./word-surface-synced-undo";

describe("word-surface-synced-undo", () => {
  it("pushes and pops the latest synced lawyer hunk", () => {
    let stack = pushSyncedLawyerUndo([], {
      taskId: "t1",
      hunkId: "h1",
      before: "甲",
      after: "甲乙",
    });
    stack = pushSyncedLawyerUndo(stack, {
      taskId: "t1",
      hunkId: "h2",
      before: "丙",
      after: "丙丁",
    });
    const first = popSyncedLawyerUndo(stack);
    expect(first.entry?.hunkId).toBe("h2");
    const second = popSyncedLawyerUndo(first.stack);
    expect(second.entry?.hunkId).toBe("h1");
    expect(popSyncedLawyerUndo(second.stack).entry).toBeNull();
  });

  it("matches pending lawyer hunks to the live edits just synced", () => {
    const matched = matchSyncedLawyerHunks(
      [
        { hunkId: "a", before: "原文", after: "原文你好", status: "pending" },
        { hunkId: "b", before: "别的", after: "别的改", status: "accepted" },
      ],
      [{ before: "原文", after: "原文你好" }],
    );
    expect(matched).toEqual([{ hunkId: "a", before: "原文", after: "原文你好" }]);
  });
});

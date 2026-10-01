import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addWordSurfaceComment,
  listWordSurfaceComments,
  removeWordSurfaceComment,
  updateWordSurfaceComment,
} from "./word-surface-comments.js";

describe("word-surface-comments", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("adds, updates, and removes a comment without touching redline hunks", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-ws-comments-"));
    dirs.push(workspaceDir);
    const added = addWordSurfaceComment(workspaceDir, {
      taskId: "task-1",
      anchorText: "付款期限",
      body: "请核对天数",
      author: "张三",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(listWordSurfaceComments(workspaceDir, "task-1")).toHaveLength(1);
    const updated = updateWordSurfaceComment(
      workspaceDir,
      "task-1",
      added.comment.commentId,
      "改成三十日",
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }
    expect(updated.comment.body).toBe("改成三十日");
    expect(removeWordSurfaceComment(workspaceDir, "task-1", added.comment.commentId)).toEqual({
      ok: true,
    });
    expect(listWordSurfaceComments(workspaceDir, "task-1")).toHaveLength(0);
  });

  it("rejects path-like task ids", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-ws-comments-"));
    dirs.push(workspaceDir);
    const added = addWordSurfaceComment(workspaceDir, {
      taskId: "../escape",
      anchorText: "付款期限",
      body: "请核对天数",
      author: "张三",
    });
    expect(added).toEqual({ ok: false, error: "invalid_task" });
    expect(listWordSurfaceComments(workspaceDir, "../escape")).toEqual([]);
  });
});

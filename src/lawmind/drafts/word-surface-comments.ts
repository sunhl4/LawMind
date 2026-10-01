/**
 * Light comment cards for the chat-middle Word preview.
 * Separate from redline hunks: accepting a revision does not drop a comment.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, withExclusiveFileLock } from "../adapters/matter-storage/io.js";

export type WordSurfaceComment = {
  commentId: string;
  taskId: string;
  /** Selected anchor text in the open document. */
  anchorText: string;
  body: string;
  author: string;
  createdAt: string;
};

type CommentFile = {
  taskId: string;
  comments: WordSurfaceComment[];
  updatedAt: string;
};

function commentsPath(workspaceDir: string, taskId: string): string | null {
  const id = taskId.trim();
  if (!id || id.length > 200 || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return null;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    return null;
  }
  return path.join(path.resolve(workspaceDir), "drafts", `${id}.word-surface-comments.json`);
}

function commentsLockPath(workspaceDir: string, taskId: string): string | null {
  const target = commentsPath(workspaceDir, taskId);
  return target ? `${target}.lock` : null;
}

function readFile(workspaceDir: string, taskId: string): CommentFile {
  const empty = {
    taskId,
    comments: [] as WordSurfaceComment[],
    updatedAt: new Date().toISOString(),
  };
  const target = commentsPath(workspaceDir, taskId);
  try {
    if (!target || !fs.existsSync(target)) {
      return empty;
    }
    const raw = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<CommentFile>;
    const comments = Array.isArray(raw.comments)
      ? raw.comments.filter((row): row is WordSurfaceComment => {
          if (!row || typeof row !== "object") {
            return false;
          }
          return (
            typeof row.commentId === "string" &&
            typeof row.anchorText === "string" &&
            typeof row.body === "string"
          );
        })
      : [];
    return {
      taskId,
      comments,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { taskId, comments: [], updatedAt: new Date().toISOString() };
  }
}

export function listWordSurfaceComments(
  workspaceDir: string,
  taskId: string,
): WordSurfaceComment[] {
  return readFile(workspaceDir, taskId).comments;
}

export function addWordSurfaceComment(
  workspaceDir: string,
  input: { taskId: string; anchorText: string; body: string; author: string },
): { ok: true; comment: WordSurfaceComment } | { ok: false; error: string } {
  const taskId = input.taskId.trim();
  const anchorText = input.anchorText.trim();
  const body = input.body.trim();
  const author = input.author.trim() || "律师";
  if (!taskId || !anchorText || anchorText.length > 2_000) {
    return { ok: false, error: "invalid_anchor" };
  }
  if (body.length > 8_000) {
    return { ok: false, error: "invalid_body" };
  }
  const lock = commentsLockPath(workspaceDir, taskId);
  const target = commentsPath(workspaceDir, taskId);
  if (!lock || !target) {
    return { ok: false, error: "invalid_task" };
  }
  return withExclusiveFileLock(lock, () => {
    const file = readFile(workspaceDir, taskId);
    const comment: WordSurfaceComment = {
      commentId: randomUUID(),
      taskId,
      anchorText: anchorText.slice(0, 2_000),
      body: body.slice(0, 8_000) || "批注",
      author: author.slice(0, 80),
      createdAt: new Date().toISOString(),
    };
    file.comments.push(comment);
    file.updatedAt = comment.createdAt;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeJsonAtomic(target, file);
    return { ok: true as const, comment };
  });
}

export function updateWordSurfaceComment(
  workspaceDir: string,
  taskId: string,
  commentId: string,
  body: string,
): { ok: true; comment: WordSurfaceComment } | { ok: false; error: string } {
  const nextBody = body.trim();
  if (!taskId.trim() || !commentId.trim() || nextBody.length > 8_000) {
    return { ok: false, error: "invalid_body" };
  }
  const lock = commentsLockPath(workspaceDir, taskId);
  const target = commentsPath(workspaceDir, taskId);
  if (!lock || !target) {
    return { ok: false, error: "invalid_task" };
  }
  return withExclusiveFileLock(lock, () => {
    const file = readFile(workspaceDir, taskId);
    const comment = file.comments.find((row) => row.commentId === commentId);
    if (!comment) {
      return { ok: false as const, error: "comment_not_found" };
    }
    comment.body = nextBody.slice(0, 8_000) || "批注";
    file.updatedAt = new Date().toISOString();
    writeJsonAtomic(target, file);
    return { ok: true as const, comment };
  });
}

export function removeWordSurfaceComment(
  workspaceDir: string,
  taskId: string,
  commentId: string,
): { ok: true } | { ok: false; error: string } {
  if (!taskId.trim() || !commentId.trim()) {
    return { ok: false, error: "invalid_comment" };
  }
  const lock = commentsLockPath(workspaceDir, taskId);
  const target = commentsPath(workspaceDir, taskId);
  if (!lock || !target) {
    return { ok: false, error: "invalid_task" };
  }
  return withExclusiveFileLock(lock, () => {
    const file = readFile(workspaceDir, taskId);
    const before = file.comments.length;
    file.comments = file.comments.filter((row) => row.commentId !== commentId);
    if (file.comments.length === before) {
      return { ok: false as const, error: "comment_not_found" };
    }
    file.updatedAt = new Date().toISOString();
    writeJsonAtomic(target, file);
    return { ok: true as const };
  });
}

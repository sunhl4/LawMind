/**
 * 案件审查矩阵的批注与「已核对」标记。
 * 存在案件目录里，换机器仍在；不再只放浏览器 localStorage。
 */

import fs from "node:fs";
import path from "node:path";
import {
  matterDir,
  withExclusiveFileLock,
  writeJsonAtomic,
} from "../adapters/matter-storage/io.js";

export type ReviewMatrixNoteFile = {
  notes: Record<string, string>;
  verified: Record<string, boolean>;
};

const EMPTY: ReviewMatrixNoteFile = { notes: {}, verified: {} };

export function reviewMatrixNotesPath(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "review-matrix-notes.json");
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim()) {
      out[key] = raw;
    }
  }
  return out;
}

function asBoolRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === true) {
      out[key] = true;
    }
  }
  return out;
}

export function readReviewMatrixNotes(
  workspaceDir: string,
  matterId: string,
): ReviewMatrixNoteFile {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(reviewMatrixNotesPath(workspaceDir, matterId), "utf8"),
    ) as { notes?: unknown; verified?: unknown };
    return { notes: asStringRecord(parsed.notes), verified: asBoolRecord(parsed.verified) };
  } catch {
    return { ...EMPTY, notes: {}, verified: {} };
  }
}

export function writeReviewMatrixNotes(
  workspaceDir: string,
  matterId: string,
  store: ReviewMatrixNoteFile,
): ReviewMatrixNoteFile {
  const next: ReviewMatrixNoteFile = {
    notes: asStringRecord(store.notes),
    verified: asBoolRecord(store.verified),
  };
  const file = reviewMatrixNotesPath(workspaceDir, matterId);
  // 原子写 + 文件锁：崩溃留半截 JSON 时读侧会静默回 EMPTY，批注等于全丢。
  withExclusiveFileLock(`${file}.lock`, () => {
    writeJsonAtomic(file, next);
  });
  return next;
}

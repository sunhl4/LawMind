/**
 * Draft snapshot persistence.
 *
 * 目的：
 * - 让草稿在会话结束后仍可继续审核/渲染
 * - 为后续 UI 审核台提供稳定数据源
 */

import fs from "node:fs";
import path from "node:path";
import type { ArtifactDraft } from "../types.js";

function draftsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "drafts");
}

export function draftPath(workspaceDir: string, taskId: string): string {
  return path.join(draftsDir(workspaceDir), `${taskId}.json`);
}

export function persistDraft(workspaceDir: string, draft: ArtifactDraft): string {
  const target = draftPath(workspaceDir, draft.taskId);
  fs.mkdirSync(draftsDir(workspaceDir), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(draft, null, 2));
  return target;
}

export function readDraft(workspaceDir: string, taskId: string): ArtifactDraft | undefined {
  try {
    const content = fs.readFileSync(draftPath(workspaceDir, taskId), "utf8");
    return JSON.parse(content) as ArtifactDraft;
  } catch {
    return undefined;
  }
}

export function listDrafts(workspaceDir: string): ArtifactDraft[] {
  try {
    const dir = draftsDir(workspaceDir);
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .toSorted();
    return files
      .map((name) => {
        try {
          const content = fs.readFileSync(path.join(dir, name), "utf8");
          return JSON.parse(content) as ArtifactDraft;
        } catch {
          return undefined;
        }
      })
      .filter((draft): draft is ArtifactDraft => Boolean(draft))
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

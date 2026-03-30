/**
 * Persist ResearchBundle next to draft so citation integrity and audit can be recomputed later.
 */

import fs from "node:fs";
import path from "node:path";
import type { ResearchBundle } from "../types.js";

export function researchSnapshotPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.research.json`);
}

export function persistResearchSnapshot(workspaceDir: string, bundle: ResearchBundle): string {
  const target = researchSnapshotPath(workspaceDir, bundle.taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(bundle, null, 2));
  return target;
}

export function readResearchSnapshot(
  workspaceDir: string,
  taskId: string,
): ResearchBundle | undefined {
  try {
    const target = researchSnapshotPath(workspaceDir, taskId);
    const raw = fs.readFileSync(target, "utf8");
    return JSON.parse(raw) as ResearchBundle;
  } catch {
    return undefined;
  }
}

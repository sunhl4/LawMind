/**
 * Persist ResearchBundle next to draft so citation integrity and audit can be recomputed later.
 */

import fs from "node:fs";
import path from "node:path";
import type { ResearchBundle } from "../types.js";
import { checkEvidenceSupport } from "./evidence-support.js";

export function researchSnapshotPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.research.json`);
}

export function persistResearchSnapshot(workspaceDir: string, bundle: ResearchBundle): string {
  const target = researchSnapshotPath(workspaceDir, bundle.taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const sources = bundle.sources.map((source) => {
    // Persisting is not retrieval: never retroactively bless the current bytes as
    // the version of an older excerpt. Unknown remains unknown.
    if (source.sourceVersion || !source.url || /^https?:\/\//i.test(source.url)) {
      return source;
    }
    const quote =
      source.excerpt ??
      bundle.claims.find((claim) => claim.sourceIds.includes(source.id))?.pin?.quote;
    const checked = checkEvidenceSupport({ rootDir: workspaceDir, relPath: source.url, quote });
    return checked.status === "supported" && checked.actualVersion
      ? { ...source, sourceVersion: checked.actualVersion }
      : source;
  });
  fs.writeFileSync(target, JSON.stringify({ ...bundle, sources }, null, 2));
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

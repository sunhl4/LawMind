import path from "node:path";
import type { ArtifactDraft } from "../types.js";

const draftListGenByWorkspace = new Map<string, number>();
const draftListCacheByWorkspace = new Map<string, { gen: number; drafts: ArtifactDraft[] }>();

export function invalidateDraftListCache(workspaceDir?: string): void {
  if (!workspaceDir) {
    draftListGenByWorkspace.clear();
    draftListCacheByWorkspace.clear();
    return;
  }
  const key = path.resolve(workspaceDir);
  draftListGenByWorkspace.set(key, (draftListGenByWorkspace.get(key) ?? 0) + 1);
  draftListCacheByWorkspace.delete(key);
}

export function readDraftListCache(workspaceDir: string): {
  gen: number;
  drafts: ArtifactDraft[];
} | null {
  const key = path.resolve(workspaceDir);
  const gen = draftListGenByWorkspace.get(key) ?? 0;
  const hit = draftListCacheByWorkspace.get(key);
  if (hit && hit.gen === gen) {
    return { gen, drafts: hit.drafts };
  }
  return null;
}

/** 仅当 gen 仍是当前代际时写回，避免「扫描中途被 invalidate」把旧快照挂到新 gen 上。 */
export function writeDraftListCache(
  workspaceDir: string,
  drafts: ArtifactDraft[],
  genAtScanStart: number,
): void {
  const key = path.resolve(workspaceDir);
  const current = draftListGenByWorkspace.get(key) ?? 0;
  if (current !== genAtScanStart) {
    return;
  }
  draftListCacheByWorkspace.set(key, { gen: genAtScanStart, drafts });
}

export function draftListCacheGen(workspaceDir: string): number {
  return draftListGenByWorkspace.get(path.resolve(workspaceDir)) ?? 0;
}

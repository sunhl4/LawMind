/**
 * In-process host helper (本机助手). Same API a future lawmind-hostd would expose.
 * Tools call these functions instead of touching the filesystem directly.
 */

import fs from "node:fs";
import path from "node:path";
import { walkDirectoryListing, withToolReadyListingPaths } from "../runtime/list-dir.js";
import type { ListDirEntry } from "../runtime/list-dir.js";
import { resolveHostPath } from "./access-broker.js";
import { rebuildHostIndex } from "./host-index.js";
import { searchHost } from "./host-search.js";
import type { HostAccessRuntime, HostSearchHit } from "./types.js";

const MAX_TEXT_READ_BYTES = 1_000_000;

export type HostdListItem = {
  name: string;
  rel: string;
  isDir: boolean;
};

export function hostdList(runtime: HostAccessRuntime, mountId?: string): HostdListItem[] {
  const mount = mountId ? runtime.mounts.find((m) => m.id === mountId) : runtime.mounts[0];
  if (!mount) {
    return [];
  }
  const resolved = resolveHostPath(runtime, mount.absPath);
  if (!resolved.ok) {
    return [];
  }
  try {
    return fs.readdirSync(resolved.abs, { withFileTypes: true }).map((ent) => ({
      name: ent.name,
      rel: ent.name,
      isDir: ent.isDirectory(),
    }));
  } catch {
    return [];
  }
}

export function hostdSearch(runtime: HostAccessRuntime, query: string): HostSearchHit[] {
  return searchHost(runtime, query);
}

export function hostdRead(
  runtime: HostAccessRuntime,
  rawPath: string,
):
  | {
      ok: true;
      text: string;
      abs: string;
      rel: string;
      directory?: boolean;
      entries?: ListDirEntry[];
      truncated?: boolean;
    }
  | { ok: false; error: string; needsGrant?: boolean; message?: string } {
  const resolved = resolveHostPath(runtime, rawPath, { allowLocateHint: true });
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      needsGrant: resolved.error === "needs_grant",
      message: resolved.message,
    };
  }
  try {
    const st = fs.statSync(resolved.abs);
    if (st.isDirectory()) {
      const walked = walkDirectoryListing(resolved.abs, {
        recursive: true,
        homeDir: runtime.homeDir,
        denyPathPatterns: runtime.policy.denyPathPatterns,
      });
      const entries = withToolReadyListingPaths(resolved.rel, walked.entries);
      return {
        ok: true,
        text: entries.map((e) => (e.kind === "directory" ? `${e.path}/` : e.path)).join("\n"),
        abs: resolved.abs,
        rel: resolved.rel,
        directory: true,
        entries,
        truncated: walked.truncated,
      };
    }
    if (!st.isFile()) {
      return { ok: false, error: "not_found", message: "不是文件。" };
    }
    if (st.size > MAX_TEXT_READ_BYTES) {
      return { ok: false, error: "too_large", message: "文件过大，请先收进本案再分段阅读。" };
    }
    const buf = fs.readFileSync(resolved.abs);
    if (buf.includes(0)) {
      return { ok: false, error: "binary", message: "二进制文件请用收进本案后，再用分析文书。" };
    }
    return { ok: true, text: buf.toString("utf8"), abs: resolved.abs, rel: resolved.rel };
  } catch {
    return { ok: false, error: "not_found", message: "读不到该文件。" };
  }
}

export function hostdImport(
  runtime: HostAccessRuntime,
  rawPath: string,
  matterId: string,
): { ok: true; destRel: string } | { ok: false; error: string; message?: string } {
  const id = matterId.trim();
  if (!id) {
    return { ok: false, error: "no_matter", message: "请先关联案件再收进本案。" };
  }
  const source = resolveHostPath(runtime, rawPath, { allowLocateHint: true });
  if (!source.ok) {
    return { ok: false, error: source.error, message: source.message };
  }
  const destDir = path.join(runtime.workspaceDir, "cases", id, "materials");
  const destAbs = path.join(destDir, path.basename(source.abs));
  const destCheck = resolveHostPath(runtime, destAbs, { write: true });
  if (!destCheck.ok) {
    return { ok: false, error: destCheck.error, message: destCheck.message };
  }
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(source.abs, destCheck.abs);
    return { ok: true, destRel: `cases/${id}/materials/${path.basename(source.abs)}` };
  } catch (err) {
    return {
      ok: false,
      error: "copy_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function hostdRebuildIndex(runtime: HostAccessRuntime): { mounts: number; files: number } {
  return rebuildHostIndex(runtime);
}

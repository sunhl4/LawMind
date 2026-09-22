/**
 * In-process host helper (本机助手). Same API a future lawmind-hostd would expose.
 * Tools call these functions instead of touching the filesystem directly.
 */

import fs from "node:fs";
import path from "node:path";
import { parseMatterDisplayNameFromCase } from "../cases/matter-label.js";
import { walkDirectoryListing, withToolReadyListingPaths } from "../runtime/list-dir.js";
import type { ListDirEntry } from "../runtime/list-dir.js";
import { resolveHostPath } from "./access-broker.js";
import { isDeniedHostPath } from "./deny-list.js";
import { rebuildHostIndex } from "./host-index.js";
import { searchHost } from "./host-search.js";
import { isUnderRoot, realpathOrResolve } from "./paths.js";
import type { HostAccessRuntime, HostSearchHit } from "./types.js";

const MAX_TEXT_READ_BYTES = 1_000_000;
const IMPORT_MAX_FILES = 200;
const IMPORT_MAX_DEPTH = 8;
const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMPORT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

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
        workspaceDir: runtime.workspaceDir,
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
      return {
        ok: false,
        error: "binary",
        message:
          "这是 PDF、Word 等二进制材料，本工具只读纯文本。请用 analyze_document 或 read_folder_documents 读正文；要归档再用 import_host_file（可传整个文件夹）。",
      };
    }
    return { ok: true, text: buf.toString("utf8"), abs: resolved.abs, rel: resolved.rel };
  } catch {
    return { ok: false, error: "not_found", message: "读不到该文件。" };
  }
}

function usableMatterId(matterId: string): string | undefined {
  const id = matterId.trim();
  if (!id || id.length > 128) {
    return undefined;
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    return undefined;
  }
  return id;
}

function matterIdExists(workspaceDir: string, id: string): boolean {
  return (
    fs.existsSync(path.join(workspaceDir, "cases", id)) ||
    fs.existsSync(path.join(workspaceDir, "matters", id, "matter.json"))
  );
}

function labelsMatch(a: string, b: string): boolean {
  const norm = (value: string) => value.replace(/\s+/g, "").trim();
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && left === right;
}

function titleFromMatterJson(file: string): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { title?: unknown };
    return typeof raw.title === "string" ? raw.title.trim() : undefined;
  } catch {
    return undefined;
  }
}

function matterIdsNamed(workspaceDir: string, label: string): string[] {
  const hits = new Set<string>();
  const consider = (id: string, title: string | undefined) => {
    if (title && labelsMatch(label, title)) {
      hits.add(id);
    }
  };
  const casesRoot = path.join(workspaceDir, "cases");
  for (const name of fs.existsSync(casesRoot) ? fs.readdirSync(casesRoot) : []) {
    const caseFile = path.join(casesRoot, name, "CASE.md");
    if (!fs.existsSync(caseFile)) {
      continue;
    }
    try {
      consider(name, parseMatterDisplayNameFromCase(fs.readFileSync(caseFile, "utf8")));
    } catch {
      /* skip unreadable */
    }
  }
  const mattersRoot = path.join(workspaceDir, "matters");
  for (const name of fs.existsSync(mattersRoot) ? fs.readdirSync(mattersRoot) : []) {
    consider(name, titleFromMatterJson(path.join(mattersRoot, name, "matter.json")));
  }
  return [...hits];
}

/**
 * Session ids stay as-is (materials may not exist yet). A display name such as
 * 「刘学江侵权案」 maps to the real matter id instead of a new folder.
 */
function pickImportMatterId(
  workspaceDir: string,
  matterId: string,
): { ok: true; id: string } | { ok: false; error: string; message: string } {
  const id = usableMatterId(matterId);
  if (!id) {
    return { ok: false, error: "no_matter", message: "请先关联案件再收进本案。" };
  }
  if (matterIdExists(workspaceDir, id)) {
    return { ok: true, id };
  }
  const named = matterIdsNamed(workspaceDir, id);
  if (named.length === 1 && named[0]) {
    return { ok: true, id: named[0] };
  }
  if (named.length > 1) {
    return {
      ok: false,
      error: "no_matter",
      message: `有多个案件都叫「${id}」。请打开要收进的那一件再交办。`,
    };
  }
  return { ok: true, id };
}

function copyImportTree(
  runtime: HostAccessRuntime,
  srcRoot: string,
  destRoot: string,
): { ok: true; files: number; truncated: boolean } | { ok: false; error: string; message: string } {
  const srcAbs = realpathOrResolve(srcRoot);
  let files = 0;
  let bytes = 0;
  let truncated = false;

  const visit = (srcDir: string, destDir: string, depth: number): void => {
    if (truncated || depth > IMPORT_MAX_DEPTH) {
      if (depth > IMPORT_MAX_DEPTH) {
        truncated = true;
      }
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    for (const ent of entries) {
      if (truncated) {
        return;
      }
      if (ent.isSymbolicLink()) {
        continue;
      }
      const src = path.join(srcDir, ent.name);
      if (!isUnderRoot(srcAbs, realpathOrResolve(src))) {
        continue;
      }
      if (
        isDeniedHostPath(src, {
          homeDir: runtime.homeDir,
          extraPatterns: runtime.policy.denyPathPatterns,
          workspaceDir: runtime.workspaceDir,
        })
      ) {
        continue;
      }
      const dest = path.join(destDir, ent.name);
      if (!isUnderRoot(destRoot, dest)) {
        continue;
      }
      if (ent.isDirectory()) {
        if (ent.name.startsWith(".")) {
          continue;
        }
        visit(src, dest, depth + 1);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      let size = 0;
      try {
        size = fs.statSync(src).size;
      } catch {
        continue;
      }
      if (size > IMPORT_MAX_FILE_BYTES || bytes + size > IMPORT_MAX_TOTAL_BYTES) {
        truncated = true;
        continue;
      }
      if (files >= IMPORT_MAX_FILES) {
        truncated = true;
        return;
      }
      fs.copyFileSync(src, dest);
      files += 1;
      bytes += size;
    }
  };

  try {
    visit(srcAbs, destRoot, 0);
  } catch (err) {
    return {
      ok: false,
      error: "copy_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (files === 0) {
    return {
      ok: false,
      error: "copy_failed",
      message: truncated
        ? "文件夹过大或层级过深，没有复制进本案。"
        : "文件夹里没有可收进本案的文件。",
    };
  }
  return { ok: true, files, truncated };
}

export function hostdImport(
  runtime: HostAccessRuntime,
  rawPath: string,
  matterId: string,
):
  | { ok: true; destRel: string; files?: number; truncated?: boolean }
  | { ok: false; error: string; message?: string } {
  const picked = pickImportMatterId(runtime.workspaceDir, matterId);
  if (!picked.ok) {
    return picked;
  }
  const id = picked.id;
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
  const baseName = path.basename(source.abs);
  const destRel = `cases/${id}/materials/${baseName}`;
  try {
    const st = fs.statSync(source.abs);
    if (st.isDirectory()) {
      const copied = copyImportTree(runtime, source.abs, destCheck.abs);
      if (!copied.ok) {
        return copied;
      }
      return { ok: true, destRel, files: copied.files, truncated: copied.truncated };
    }
    if (!st.isFile()) {
      return { ok: false, error: "not_found", message: "不是文件或文件夹。" };
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(source.abs, destCheck.abs);
    return { ok: true, destRel };
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

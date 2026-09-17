/**
 * Bounded recursive directory listing (Codex `ls` / `--add-dir` analogue).
 * Does not follow symlinks. Skips junk and host deny-list paths.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildHostAccessRuntime, resolveHostPath } from "../host-access/access-broker.js";
import { isDeniedHostPath } from "../host-access/deny-list.js";
import type { HostGrant, HostMount, HostRootKind } from "../host-access/types.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveLawyerLocalDir, type LawyerFileRoot } from "./lawyer-local-file.js";
import { resolveWorkspaceRelativePathAllowRoot } from "./workspace-path.js";

export type ListDirContext = {
  workspaceDir: string;
  sessionId: string;
  matterId?: string;
  projectDir?: string;
  hostMounts?: HostMount[];
  hostGrants?: HostGrant[];
  hostAccessFile?: string;
  hostSessionCommandAllowed?: boolean;
  contextPins?: ComposeContextPin[];
};

export const LIST_DIR_MAX_ENTRIES = 400;
export const LIST_DIR_MAX_DEPTH = 8;
export const LIST_DIR_PROMPT_MAX_ENTRIES = 80;

export const LIST_DIR_SKIP_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".lawmind",
  ".vite",
  "release",
]);

export type ListDirEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
};

export type ListDirSuccess = {
  ok: true;
  rootKind: LawyerFileRoot | HostRootKind;
  listedPath: string;
  entries: ListDirEntry[];
  truncated: boolean;
  recursive: boolean;
};

export type ListDirFailure = {
  ok: false;
  error: string;
};

function shouldSkipDirName(name: string): boolean {
  return name.startsWith(".") || LIST_DIR_SKIP_NAMES.has(name);
}

function formatSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function walkDirectoryListing(
  absDir: string,
  opts?: {
    recursive?: boolean;
    maxEntries?: number;
    maxDepth?: number;
    homeDir?: string;
    denyPathPatterns?: string[];
  },
): { entries: ListDirEntry[]; truncated: boolean } {
  const recursive = opts?.recursive !== false;
  const maxEntries = opts?.maxEntries ?? LIST_DIR_MAX_ENTRIES;
  const maxDepth = opts?.maxDepth ?? LIST_DIR_MAX_DEPTH;
  const homeDir = opts?.homeDir ?? os.homedir();
  const denyPathPatterns = opts?.denyPathPatterns;
  const rootAbs = path.resolve(absDir);
  const entries: ListDirEntry[] = [];
  let truncated = false;

  const visit = (dir: string, depth: number): void => {
    if (truncated || (recursive && depth > maxDepth) || (!recursive && depth > 0)) {
      if (recursive && depth > maxDepth) {
        truncated = true;
      }
      return;
    }
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      if (aDir !== bDir) {
        return aDir - bDir;
      }
      return a.name.localeCompare(b.name, "zh");
    });
    for (const ent of dirents) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (ent.isSymbolicLink()) {
        continue;
      }
      const abs = path.join(dir, ent.name);
      if (
        isDeniedHostPath(abs, {
          homeDir,
          extraPatterns: denyPathPatterns,
        })
      ) {
        continue;
      }
      const rel = path.relative(rootAbs, abs).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (shouldSkipDirName(ent.name)) {
          continue;
        }
        entries.push({ path: rel, name: ent.name, kind: "directory" });
        if (recursive) {
          visit(abs, depth + 1);
        }
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      let size: number | undefined;
      try {
        size = fs.statSync(abs).size;
      } catch {
        size = undefined;
      }
      entries.push({ path: rel, name: ent.name, kind: "file", size });
    }
  };

  visit(rootAbs, 0);
  return { entries, truncated };
}

/** Join a listed root with a walk-relative entry so tools can consume `path` as-is. */
export function joinListedRel(listedPath: string, entryRel: string): string {
  const base = listedPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const rel = entryRel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!base) {
    return rel;
  }
  if (!rel) {
    return base;
  }
  return `${base}/${rel}`;
}

export function withToolReadyListingPaths<T extends { path: string }>(
  listedPath: string,
  entries: T[],
): T[] {
  if (!listedPath) {
    return entries;
  }
  return entries.map((entry) => ({ ...entry, path: joinListedRel(listedPath, entry.path) }));
}

export function formatDirectoryListingBlock(
  listing: ListDirSuccess,
  maxEntries = LIST_DIR_PROMPT_MAX_ENTRIES,
): string {
  const shown = listing.entries.slice(0, maxEntries);
  const lines = shown.map((e) => {
    const suffix = e.kind === "directory" ? "/" : formatSize(e.size);
    const sizeBit = e.kind === "file" && suffix ? ` ${suffix}` : "";
    return `- \`${e.path}${e.kind === "directory" ? "/" : ""}\`${sizeBit}`;
  });
  const more =
    listing.truncated || listing.entries.length > maxEntries
      ? `\n（已截断，共 ${listing.entries.length}+ 项。请用 list_dir(path, recursive=true) 继续列举，再用 analyze_document / read_project_file / read_host_file 阅读文件。）`
      : "\n请用 analyze_document / read_project_file / read_host_file 按上列相对路径阅读文件。";
  const heading = listing.listedPath
    ? `目录 \`${listing.listedPath}\`（${listing.rootKind}）`
    : `目录根（${listing.rootKind}）`;
  return `${heading}，${listing.recursive ? "递归" : "本层"} ${listing.entries.length} 项：\n${lines.join("\n")}${more}`;
}

export function directoryListingToolData(listing: ListDirSuccess): Record<string, unknown> {
  return {
    kind: "directory",
    rootKind: listing.rootKind,
    listedPath: listing.listedPath,
    recursive: listing.recursive,
    truncated: listing.truncated,
    entries: listing.entries,
    hint: listing.truncated
      ? "列举未完：请对子目录再调用 list_dir，或提高范围后重试。阅读文件请用 analyze_document / read_project_file / read_host_file。"
      : "这是目录列表，不是文件正文。请按 entries[].path 调用 analyze_document / read_project_file / read_host_file 阅读。",
  };
}

function listingFromAbs(
  abs: string,
  listedPath: string,
  rootKind: LawyerFileRoot | HostRootKind,
  recursive: boolean,
  runtime?: { homeDir?: string; policy?: { denyPathPatterns?: string[] } },
): ListDirSuccess {
  const walked = walkDirectoryListing(abs, {
    recursive,
    homeDir: runtime?.homeDir,
    denyPathPatterns: runtime?.policy?.denyPathPatterns,
  });
  return {
    ok: true,
    rootKind,
    listedPath,
    entries: withToolReadyListingPaths(listedPath, walked.entries),
    truncated: walked.truncated,
    recursive,
  };
}

export function resolveAndListDirectory(
  ctx: ListDirContext,
  rawPath: string,
  opts?: { recursive?: boolean },
): ListDirSuccess | ListDirFailure {
  const recursive = opts?.recursive !== false;
  const claimed = (rawPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^["'`]+|["'`]+$/g, "");
  const runtime = buildHostAccessRuntime({
    workspaceDir: ctx.workspaceDir,
    sessionId: ctx.sessionId,
    matterId: ctx.matterId,
    projectDir: ctx.projectDir,
    hostMounts: ctx.hostMounts,
    hostGrants: ctx.hostGrants,
    hostAccessFile: ctx.hostAccessFile,
    hostSessionCommandAllowed: ctx.hostSessionCommandAllowed,
  });
  const mountDirs = runtime.mounts.map((m) => m.absPath);
  const isRootClaim = !claimed || claimed === "." || claimed === "./";

  if (isRootClaim) {
    const dirPins = (ctx.contextPins ?? []).filter(
      (pin): pin is Extract<ComposeContextPin, { pinKind: "file" }> =>
        pin.pinKind === "file" && pin.kind === "directory",
    );
    if (dirPins.length > 0) {
      const pin = dirPins[0];
      const located = resolveLawyerLocalDir({
        workspaceDir: ctx.workspaceDir,
        projectDir: ctx.projectDir,
        mountDirs,
        raw: pin.relPath || ".",
        preferredRoot: pin.root,
        pins: [pin],
      });
      if (located) {
        return listingFromAbs(located.abs, located.rel, located.root, recursive, runtime);
      }
    }
    if (ctx.projectDir?.trim()) {
      return listingFromAbs(path.resolve(ctx.projectDir.trim()), "", "project", recursive, runtime);
    }
    return listingFromAbs(path.resolve(ctx.workspaceDir), "", "workspace", recursive, runtime);
  }

  const fromPins = resolveLawyerLocalDir({
    workspaceDir: ctx.workspaceDir,
    projectDir: ctx.projectDir,
    mountDirs,
    raw: claimed,
    pins: ctx.contextPins,
  });
  if (fromPins) {
    return listingFromAbs(fromPins.abs, fromPins.rel, fromPins.root, recursive, runtime);
  }

  const ws = resolveWorkspaceRelativePathAllowRoot(ctx.workspaceDir, claimed);
  if (ws.ok) {
    try {
      if (fs.existsSync(ws.abs) && fs.statSync(ws.abs).isDirectory()) {
        return listingFromAbs(ws.abs, ws.rel, "workspace", recursive, runtime);
      }
    } catch {
      /* fall through */
    }
  }

  if (ctx.projectDir?.trim()) {
    const proj = resolveWorkspaceRelativePathAllowRoot(ctx.projectDir.trim(), claimed);
    if (proj.ok) {
      try {
        if (fs.existsSync(proj.abs) && fs.statSync(proj.abs).isDirectory()) {
          return listingFromAbs(proj.abs, proj.rel, "project", recursive, runtime);
        }
      } catch {
        /* fall through */
      }
    }
  }

  const host = resolveHostPath(runtime, claimed);
  if (host.ok) {
    try {
      if (fs.existsSync(host.abs) && fs.statSync(host.abs).isDirectory()) {
        return listingFromAbs(host.abs, host.rel, host.rootKind, recursive, runtime);
      }
    } catch {
      /* fall through */
    }
    if (host.ok) {
      return { ok: false, error: "该路径不是目录。" };
    }
  } else if (host.error === "needs_grant") {
    return { ok: false, error: host.message };
  } else if (host.error !== "empty" && host.error !== "escape") {
    return { ok: false, error: host.message };
  }

  const located = resolveLawyerLocalDir({
    workspaceDir: ctx.workspaceDir,
    projectDir: ctx.projectDir,
    mountDirs,
    raw: claimed,
    pins: ctx.contextPins,
  });
  if (located) {
    return listingFromAbs(located.abs, located.rel, located.root, recursive, runtime);
  }

  return {
    ok: false,
    error: `找不到目录：${claimed}。已查工作区、本机文件夹与钉选路径。`,
  };
}

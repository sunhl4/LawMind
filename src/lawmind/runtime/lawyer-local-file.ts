/**
 * Resolve a lawyer-local file under the workspace and/or project folder.
 * Used by analyze_document, Word baseline stamp, and tracked export — one fence.
 */

import fs from "node:fs";
import path from "node:path";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveWorkspaceRelativePath } from "./workspace-path.js";

export type LawyerFileRoot = "workspace" | "project";

export type ResolvedLawyerLocalFile = {
  abs: string;
  rel: string;
  root: LawyerFileRoot;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".lawmind",
  "dist",
  "coverage",
  "artifacts",
  ".vite",
]);

const WORD_RE = /\.docx?$/i;

function tryExact(
  rootDir: string | undefined,
  raw: string,
  root: LawyerFileRoot,
): ResolvedLawyerLocalFile | undefined {
  if (!rootDir?.trim()) {
    return undefined;
  }
  const resolved = resolveWorkspaceRelativePath(rootDir, raw);
  if (!resolved.ok) {
    return undefined;
  }
  if (!fs.existsSync(resolved.abs) || !fs.statSync(resolved.abs).isFile()) {
    return undefined;
  }
  return { abs: resolved.abs, rel: resolved.rel, root };
}

function walkFiles(rootDir: string, maxDepth: number, maxFiles: number): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (out.length >= maxFiles || depth > maxDepth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) {
        return;
      }
      const name = ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith(".")) {
          continue;
        }
        visit(path.join(dir, name), depth + 1);
        continue;
      }
      if (ent.isFile()) {
        out.push(path.join(dir, name));
      }
    }
  };
  visit(path.resolve(rootDir), 0);
  return out;
}

function uniqueMatch(
  rootDir: string,
  root: LawyerFileRoot,
  pred: (abs: string, base: string, stem: string) => boolean,
): ResolvedLawyerLocalFile | undefined {
  const hits: string[] = [];
  for (const abs of walkFiles(rootDir, 5, 400)) {
    const base = path.basename(abs);
    const stem = base.replace(/\.[^.]+$/, "");
    if (pred(abs, base, stem)) {
      hits.push(abs);
      if (hits.length > 1) {
        return undefined;
      }
    }
  }
  if (hits.length !== 1) {
    return undefined;
  }
  const abs = hits[0];
  return {
    abs,
    rel: path.relative(rootDir, abs).replace(/\\/g, "/"),
    root,
  };
}

function findByBasenameOrPrefix(params: {
  rootDir: string;
  root: LawyerFileRoot;
  claimedBase: string;
  wordOnly: boolean;
}): ResolvedLawyerLocalFile | undefined {
  const claimedBase = params.claimedBase;
  const claimedStem = claimedBase.replace(/\.[^.]+$/, "");
  const exact = uniqueMatch(params.rootDir, params.root, (_abs, base) => {
    if (params.wordOnly && !WORD_RE.test(base)) {
      return false;
    }
    return base === claimedBase;
  });
  if (exact) {
    return exact;
  }
  if (claimedStem.length < 8) {
    return undefined;
  }
  if (!params.wordOnly && !WORD_RE.test(claimedBase)) {
    return undefined;
  }
  // Truncated pin vs full filename, e.g. 框架协.docx vs 框架协议.docx
  return uniqueMatch(params.rootDir, params.root, (_abs, base, stem) => {
    if (!WORD_RE.test(base)) {
      return false;
    }
    return stem.startsWith(claimedStem) || claimedStem.startsWith(stem);
  });
}

function fromPins(params: {
  workspaceDir: string;
  projectDir?: string;
  raw: string;
  pins?: ComposeContextPin[];
}): ResolvedLawyerLocalFile | undefined {
  const claimed = path.basename(params.raw.trim().replace(/\\/g, "/"));
  if (!claimed || !params.pins?.length) {
    return undefined;
  }
  for (const pin of params.pins) {
    if (pin.pinKind !== "file" || pin.kind !== "file") {
      continue;
    }
    const pinBase = path.basename(pin.relPath);
    if (
      pin.relPath !== params.raw &&
      pinBase !== claimed &&
      !pinBase.startsWith(claimed.replace(/\.[^.]+$/, ""))
    ) {
      continue;
    }
    const rootDir = pin.root === "project" ? params.projectDir : params.workspaceDir;
    const hit = tryExact(rootDir, pin.relPath, pin.root);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

/** Resolve a local lawyer file. Exact path first, then unique basename / Word prefix under each root. */
export function resolveLawyerLocalFile(params: {
  workspaceDir: string;
  projectDir?: string;
  raw: string;
  preferredRoot?: LawyerFileRoot;
  pins?: ComposeContextPin[];
  wordOnly?: boolean;
}): ResolvedLawyerLocalFile | undefined {
  const raw = params.raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^["'`]+|["'`]+$/g, "");
  if (!raw || raw.includes("\0")) {
    return undefined;
  }
  if (params.wordOnly && !WORD_RE.test(raw) && !WORD_RE.test(path.basename(raw))) {
    return undefined;
  }

  const pinned = fromPins(params);
  if (pinned) {
    return pinned;
  }

  const workspace = () => tryExact(params.workspaceDir, raw, "workspace");
  const project = () => tryExact(params.projectDir, raw, "project");
  const first =
    params.preferredRoot === "project" ? (project() ?? workspace()) : (workspace() ?? project());
  if (first) {
    return first;
  }

  const claimedBase = path.basename(raw);
  const search = (rootDir: string | undefined, root: LawyerFileRoot) =>
    rootDir
      ? findByBasenameOrPrefix({
          rootDir,
          root,
          claimedBase,
          wordOnly: params.wordOnly === true,
        })
      : undefined;
  if (params.preferredRoot === "project") {
    return search(params.projectDir, "project") ?? search(params.workspaceDir, "workspace");
  }
  return search(params.workspaceDir, "workspace") ?? search(params.projectDir, "project");
}

export function formatLocatedWordBaselines(params: {
  workspaceDir: string;
  projectDir?: string;
  pins?: ComposeContextPin[];
}): string | undefined {
  const pins = params.pins ?? [];
  const lines: string[] = [];
  for (const pin of pins) {
    if (pin.pinKind !== "file" || pin.kind !== "file" || !WORD_RE.test(pin.relPath)) {
      continue;
    }
    const found = resolveLawyerLocalFile({
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      raw: pin.relPath,
      preferredRoot: pin.root,
      pins,
      wordOnly: true,
    });
    if (found) {
      lines.push(
        `- [${found.root === "project" ? "项目" : "工作区"}] \`${found.rel}\` — 请用 analyze_document 读取此路径，并把它作为 contract_edit_baseline_path。`,
      );
    } else {
      lines.push(
        `- [${pin.root === "project" ? "项目" : "工作区"}] \`${pin.relPath}\` — 尚未在磁盘定位到；项目文件必须用 read_project_file，不要当成工作区根下的文件。`,
      );
    }
  }
  if (lines.length === 0) {
    return undefined;
  }
  return ["## 已钉选的 Word 基线", "", ...lines].join("\n");
}

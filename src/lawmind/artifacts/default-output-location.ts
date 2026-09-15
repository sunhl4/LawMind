/**
 * Default deliverable location when the lawyer did not name an output path.
 *
 * Mirrors Cursor / Codex, not a global dumpster:
 *   Cursor — write into the open workspace / next to the related file; never invent a hash dump.
 *   Codex  — workspace is `--cd` / cwd; user files go in that tree, not $CODEX_HOME.
 *
 * LawMind mapping (first match wins):
 *   1. lawyer-named well-known place (桌面 / 下载 / 文稿) when delivery compiled it
 *   2. explicit path or directory (workspace, project, or that named place)
 *   3. beside the source file this deliverable is derived from
 *   4. current matter: cases/<matterId>/artifacts/
 *   5. associated project folder (the folder the lawyer opened)
 *   6. workspace artifacts/ last resort
 *
 * Filenames are 标题_YYYYMMDD_01.ext — never task-id hashes.
 * A lawyer-named place is not full-disk write: only Desktop / Downloads / Documents.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import { isPathInsideRoot } from "../runtime/workspace-path.js";
import { buildDeliverableFilename, resolveMatterWorkspaceDir } from "./matter-word-delivery.js";
import { isAllowedNamedUserPlaceDir } from "./named-user-place.js";

export type DefaultOutputKind = "deliverable" | "note";

export type DefaultOutputReason =
  | "explicit"
  | "named_place"
  | "beside_source"
  | "matter"
  | "project"
  | "workspace_artifacts"
  | "workspace_notes";

export type PlannedDeliverableLocation = {
  outDir: string;
  filename: string;
  outputPath: string;
  reason: DefaultOutputReason;
};

export type ResolveDeliverableLocationResult =
  | { ok: true; planned: PlannedDeliverableLocation }
  | { ok: false; error: string };

const DELIVERABLE_FILE_EXT_RE = /\.(docx|pptx|xlsx|md)$/i;
const PROJECT_PREFERRED_SUBDIRS = ["artifacts", "deliverables"] as const;

export function isWorkspaceDeliverableRel(rel: string): boolean {
  const n = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.includes("..") || n.includes("\0")) {
    return false;
  }
  if (n.startsWith("artifacts/") && n.length > "artifacts/".length) {
    return true;
  }
  return /^cases\/[^/]+\/artifacts\/.+$/.test(n);
}

export function workspaceDeliverableRel(
  workspaceDir: string,
  outputPath: string,
): string | undefined {
  const raw = outputPath.trim();
  if (!raw) {
    return undefined;
  }
  const root = path.resolve(workspaceDir);
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (!isPathInsideRoot(root, abs)) {
    return undefined;
  }
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  return isWorkspaceDeliverableRel(rel) ? rel : undefined;
}

function isWritableOutputDir(
  workspaceDir: string,
  projectDir: string | undefined,
  outDir: string,
  namedPlaceDir?: string,
  homeDir?: string,
): boolean {
  const resolved = path.resolve(outDir);
  if (isPathInsideRoot(workspaceDir, resolved)) {
    return true;
  }
  const project = projectDir?.trim();
  if (project && isPathInsideRoot(project, resolved)) {
    return true;
  }
  const named = namedPlaceDir?.trim();
  return Boolean(
    named && isAllowedNamedUserPlaceDir(named, { homeDir }) && isPathInsideRoot(named, resolved),
  );
}

function preferExistingProjectSubdir(projectRoot: string): string {
  for (const name of PROJECT_PREFERRED_SUBDIRS) {
    const candidate = path.join(projectRoot, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  return projectRoot;
}

function finish(
  outDir: string,
  filename: string,
  reason: DefaultOutputReason,
): PlannedDeliverableLocation {
  return {
    outDir,
    filename,
    outputPath: path.join(outDir, filename),
    reason,
  };
}

function namedFile(explicitAbs: string): { outDir: string; filename: string } | undefined {
  if (!DELIVERABLE_FILE_EXT_RE.test(explicitAbs)) {
    return undefined;
  }
  return { outDir: path.dirname(explicitAbs), filename: path.basename(explicitAbs) };
}

function resolveUnderRoot(root: string, raw: string): string | undefined {
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  return isPathInsideRoot(root, abs) ? abs : undefined;
}

/**
 * Honor an explicit file or directory. Escaping both workspace and project is an error
 * (do not silently fall through to artifacts/).
 */
function resolveExplicitOutput(params: {
  workspaceDir: string;
  projectDir?: string;
  explicitOutput: string;
  title: string;
  extension: string;
  at: Date;
  namedPlaceDir?: string;
  homeDir?: string;
  protectSourcePath?: string;
}): ResolveDeliverableLocationResult {
  const raw = params.explicitOutput.trim();
  const wsAbs = resolveUnderRoot(params.workspaceDir, raw);
  const proj = params.projectDir?.trim();
  const projAbs = proj ? resolveUnderRoot(proj, raw) : undefined;
  const named = params.namedPlaceDir?.trim();
  const namedRoot =
    named && isAllowedNamedUserPlaceDir(named, { homeDir: params.homeDir })
      ? path.resolve(named)
      : undefined;
  const namedAbs = namedRoot ? resolveUnderRoot(namedRoot, raw) : undefined;
  const abs = wsAbs ?? projAbs ?? namedAbs;
  if (!abs) {
    return { ok: false, error: "指定的输出路径不在工作区或已关联项目目录内。" };
  }

  let outDir: string;
  let filename: string | undefined;
  const asFile = namedFile(abs);
  if (asFile) {
    outDir = asFile.outDir;
    filename = asFile.filename;
  } else {
    outDir = abs;
  }
  if (
    !isWritableOutputDir(
      params.workspaceDir,
      params.projectDir,
      outDir,
      params.namedPlaceDir,
      params.homeDir,
    )
  ) {
    return { ok: false, error: "指定的输出目录不可写入。" };
  }
  const protectedSrc = params.protectSourcePath?.trim();
  if (protectedSrc && filename && path.resolve(outDir, filename) === path.resolve(protectedSrc)) {
    filename = undefined;
  }
  const name =
    filename ??
    buildDeliverableFilename(params.title, params.extension, params.at, {
      dirForUniqueness: outDir,
    });
  return { ok: true, planned: finish(outDir, name, "explicit") };
}

function filenameInDir(
  title: string,
  ext: string,
  at: Date,
  outDir: string,
  keepFilename?: string,
): string {
  const kept = keepFilename?.trim();
  if (kept) {
    return path.basename(kept);
  }
  return buildDeliverableFilename(title, ext, at, { dirForUniqueness: outDir });
}

export function resolveDefaultDeliverableLocation(params: {
  workspaceDir: string;
  projectDir?: string;
  /** Full file path or directory. When set, must stay in workspace, project, or named place. */
  explicitOutput?: string;
  matterId?: string;
  /** Existing file this deliverable is derived from. */
  sourcePath?: string;
  title: string;
  extension: string;
  at?: Date;
  /** `note` stays in workspace notes/ (never artifacts/) so write_document cannot bypass draft gates. */
  kind?: DefaultOutputKind;
  /** Use this basename in the resolved directory instead of 标题_日期_01. */
  keepFilename?: string;
  /**
   * Lawyer-named Desktop / Downloads / Documents. Wins over workspace artifacts
   * and beside-source. Only allowed when it is one of those three home folders.
   */
  namedPlaceDir?: string;
  homeDir?: string;
  /** Never write a new deliverable on top of this source file. */
  protectSourcePath?: string;
}): ResolveDeliverableLocationResult {
  const at = params.at ?? new Date();
  const kind = params.kind ?? "deliverable";
  const title = params.title.trim() || (kind === "note" ? "工作笔记" : "文书");
  const ext = params.extension.trim() || (kind === "note" ? ".md" : ".docx");
  const leafDir = kind === "note" ? "notes" : "artifacts";
  const named =
    kind === "deliverable" && params.namedPlaceDir?.trim()
      ? params.namedPlaceDir.trim()
      : undefined;
  const namedOk =
    named && isAllowedNamedUserPlaceDir(named, { homeDir: params.homeDir })
      ? path.resolve(named)
      : undefined;

  if (namedOk) {
    const explicitNamed = params.explicitOutput?.trim();
    if (explicitNamed) {
      const resolved = resolveExplicitOutput({
        workspaceDir: params.workspaceDir,
        projectDir: params.projectDir,
        explicitOutput: explicitNamed,
        title,
        extension: ext,
        at,
        namedPlaceDir: namedOk,
        homeDir: params.homeDir,
        protectSourcePath: params.protectSourcePath,
      });
      if (resolved.ok && isPathInsideRoot(namedOk, resolved.planned.outDir)) {
        return { ok: true, planned: { ...resolved.planned, reason: "named_place" } };
      }
    }
    const filename = filenameInDir(title, ext, at, namedOk);
    const planned = finish(namedOk, filename, "named_place");
    const protect = params.protectSourcePath?.trim();
    if (protect && path.resolve(planned.outputPath) === path.resolve(protect)) {
      return {
        ok: false,
        error: "不能覆盖源文件。请写入新的意见书文档。",
      };
    }
    return { ok: true, planned };
  }

  const explicit = params.explicitOutput?.trim();
  if (explicit) {
    return resolveExplicitOutput({
      workspaceDir: params.workspaceDir,
      projectDir: kind === "note" ? undefined : params.projectDir,
      explicitOutput: explicit,
      title,
      extension: ext,
      at,
      namedPlaceDir: named,
      homeDir: params.homeDir,
      protectSourcePath: params.protectSourcePath,
    });
  }

  const source = kind === "deliverable" ? params.sourcePath?.trim() : undefined;
  if (source) {
    const resolved = resolveLawyerLocalFile({
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      raw: source,
    });
    if (resolved) {
      const outDir = path.dirname(resolved.abs);
      if (isWritableOutputDir(params.workspaceDir, params.projectDir, outDir)) {
        return {
          ok: true,
          planned: finish(
            outDir,
            filenameInDir(title, ext, at, outDir, params.keepFilename),
            "beside_source",
          ),
        };
      }
    }
  }

  const matterId = params.matterId?.trim();
  if (matterId) {
    try {
      const outDir = path.join(resolveMatterWorkspaceDir(params.workspaceDir, matterId), leafDir);
      return {
        ok: true,
        planned: finish(
          outDir,
          filenameInDir(title, ext, at, outDir, params.keepFilename),
          "matter",
        ),
      };
    } catch {
      /* invalid matter id — fall through */
    }
  }

  if (kind === "deliverable") {
    const project = params.projectDir?.trim();
    if (project) {
      const root = path.resolve(project);
      const outDir = preferExistingProjectSubdir(root);
      if (isWritableOutputDir(params.workspaceDir, project, outDir)) {
        return {
          ok: true,
          planned: finish(
            outDir,
            filenameInDir(title, ext, at, outDir, params.keepFilename),
            "project",
          ),
        };
      }
    }
  }

  const outDir = path.join(path.resolve(params.workspaceDir), leafDir);
  return {
    ok: true,
    planned: finish(
      outDir,
      filenameInDir(title, ext, at, outDir, params.keepFilename),
      kind === "note" ? "workspace_notes" : "workspace_artifacts",
    ),
  };
}

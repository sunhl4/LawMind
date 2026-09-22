/**
 * Shared Word revision delivery (mail, file-page, and any existing-Word edit).
 * Copy the original, write next to the source, name 原名_YYYYMMDD_01.docx.
 * Never mutates the lawyer's original. Never uses task-id / hash suffixes.
 */

import path from "node:path";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import { isPathInsideRoot } from "../runtime/workspace-path.js";
import {
  buildMatterReviewedWordFilename,
  resolveMatterWorkspaceDir,
} from "./matter-word-delivery.js";

export type WordBaselineRoot = "workspace" | "project";

export type ResolvedWordBaseline = {
  abs: string;
  rel: string;
  root: WordBaselineRoot;
};

const WORD_BASELINE_RE = /\.docx?$/i;
/** Trailing `_YYYYMMDD`, `_YYYYMMDD_01`, or legacy `_YYYYMMDD_HHmmss`. */
const REVISION_STAMP_RE = /_\d{8}(?:_\d{2})?(?:_\d{6})?$/;

export function isWordBaselineFilename(name: string): boolean {
  return WORD_BASELINE_RE.test(name.trim());
}

/** Drop a prior delivery stamp so re-exporting a revision stays `stem_日期_02`. */
export function stripWordRevisionStamp(stem: string): string {
  return stem.replace(REVISION_STAMP_RE, "") || stem;
}

/**
 * `原文件名_YYYYMMDD_01.docx`. Collision increments 02, 03, …
 */
export function buildWordRevisionFilename(
  originalBasename: string,
  at: Date = new Date(),
  opts?: { dirForUniqueness?: string },
): string {
  return buildMatterReviewedWordFilename(originalBasename, at, opts);
}

/** Resolve a Word baseline under the workspace and/or the lawyer's project folder. */
export function resolveWordBaselineAbs(params: {
  workspaceDir: string;
  projectDir?: string;
  raw: string;
  preferredRoot?: WordBaselineRoot;
  pins?: ComposeContextPin[];
}): ResolvedWordBaseline | undefined {
  return resolveLawyerLocalFile({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    raw: params.raw,
    preferredRoot: params.preferredRoot,
    pins: params.pins,
    wordOnly: true,
  });
}

export type PlannedWordRevisionDelivery = {
  outDir: string;
  outputFileName: string;
  baselineAbs?: string;
  baselineRel?: string;
  baselineRoot?: WordBaselineRoot;
};

function assertWritableDeliveryDir(params: {
  workspaceDir: string;
  projectDir?: string;
  outDir: string;
}): boolean {
  const out = path.resolve(params.outDir);
  if (isPathInsideRoot(params.workspaceDir, out)) {
    return true;
  }
  const project = params.projectDir?.trim();
  return Boolean(project && isPathInsideRoot(project, out));
}

/**
 * Default: write next to the source Word file.
 * Fallback: matter folder, then workspace `artifacts/` — still date+version, never task-id.
 */
export function planTrackedWordDelivery(params: {
  workspaceDir: string;
  projectDir?: string;
  baselineRel?: string;
  baselineRoot?: WordBaselineRoot;
  matterId?: string;
  fallbackBasename?: string;
  pins?: ComposeContextPin[];
  at?: Date;
}): PlannedWordRevisionDelivery {
  const at = params.at ?? new Date();
  if (params.baselineRel?.trim()) {
    const baseline = resolveWordBaselineAbs({
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      raw: params.baselineRel,
      preferredRoot: params.baselineRoot,
      pins: params.pins,
    });
    if (baseline) {
      const outDir = path.dirname(baseline.abs);
      if (assertWritableDeliveryDir({ ...params, outDir })) {
        return {
          outDir,
          outputFileName: buildWordRevisionFilename(path.basename(baseline.abs), at, {
            dirForUniqueness: outDir,
          }),
          baselineAbs: baseline.abs,
          baselineRel: baseline.rel,
          baselineRoot: baseline.root,
        };
      }
    }
  }

  const fallbackName = params.fallbackBasename?.trim() || "合同.docx";
  if (params.matterId?.trim()) {
    try {
      const outDir = resolveMatterWorkspaceDir(params.workspaceDir, params.matterId);
      return {
        outDir,
        outputFileName: buildWordRevisionFilename(fallbackName, at, { dirForUniqueness: outDir }),
      };
    } catch {
      /* invalid matter id — fall through */
    }
  }

  const outDir = path.join(path.resolve(params.workspaceDir), "artifacts");
  return {
    outDir,
    outputFileName: buildWordRevisionFilename(fallbackName, at, { dirForUniqueness: outDir }),
  };
}

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

/**
 * 写副本（另存审阅稿 / 导 PDF / 比较稿）该落在哪个目录。
 *
 * 律师的习惯是「改动跟着原件走」：
 * - 原件在工作区或本机项目夹里 → 就写在原件旁边（同名 `_日期_01`）；
 * - 原件在工作区之外（助手在别处找到的文件）→ 不往那个外部目录里新塞文件，
 *   而是导到**本次会话工作区的导出位置**（`artifacts/`，有案件则案件 `artifacts/`）。
 *
 * 这样中栏里每一份产物都还在一个「LawMind 管得住」的地方：能再次打开、能列为交付、
 * 能被审计；外部目录只承受律师显式同意的那一次写回。
 */
export function exportDirForSource(params: {
  workspaceDir: string;
  projectDir?: string;
  matterId?: string;
  /** 源文件绝对路径；不知道时按工作区导出位置处理。 */
  sourceAbs?: string;
}): string {
  const ws = path.resolve(params.workspaceDir);
  const project = params.projectDir?.trim() ? path.resolve(params.projectDir) : "";
  const source = params.sourceAbs?.trim() ? path.resolve(params.sourceAbs) : "";
  if (source && (isPathInsideRoot(ws, source) || (project && isPathInsideRoot(project, source)))) {
    return path.dirname(source);
  }
  const matterId = params.matterId?.trim();
  if (matterId) {
    try {
      return path.join(resolveMatterWorkspaceDir(ws, matterId), "artifacts");
    } catch {
      /* invalid matter id — fall through */
    }
  }
  return path.join(ws, "artifacts");
}

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
/**
 * Re-export overwrites the sibling already written for this draft.
 * A path outside the planned folder is ignored so a memo output cannot be reused.
 */
export function reuseTrackedSiblingFileName(
  outDir: string,
  existingOutputAbs?: string,
): string | undefined {
  const abs = existingOutputAbs?.trim();
  if (!abs) {
    return undefined;
  }
  const resolved = path.resolve(abs);
  if (path.dirname(resolved) !== path.resolve(outDir)) {
    return undefined;
  }
  const base = path.basename(resolved);
  if (!/\.docx$/i.test(base)) {
    return undefined;
  }
  return base;
}

export function planTrackedWordDelivery(params: {
  workspaceDir: string;
  projectDir?: string;
  baselineRel?: string;
  baselineRoot?: WordBaselineRoot;
  matterId?: string;
  fallbackBasename?: string;
  pins?: ComposeContextPin[];
  at?: Date;
  /** When set and beside the baseline, keep this filename instead of `_02`. */
  existingOutputAbs?: string;
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
          outputFileName:
            reuseTrackedSiblingFileName(outDir, params.existingOutputAbs) ??
            buildWordRevisionFilename(path.basename(baseline.abs), at, {
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
        outputFileName:
          reuseTrackedSiblingFileName(outDir, params.existingOutputAbs) ??
          buildWordRevisionFilename(fallbackName, at, { dirForUniqueness: outDir }),
      };
    } catch {
      /* invalid matter id — fall through */
    }
  }

  const outDir = path.join(path.resolve(params.workspaceDir), "artifacts");
  return {
    outDir,
    outputFileName:
      reuseTrackedSiblingFileName(outDir, params.existingOutputAbs) ??
      buildWordRevisionFilename(fallbackName, at, { dirForUniqueness: outDir }),
  };
}

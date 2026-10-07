/**
 * Write the tracked sibling for a draft, reusing the filename already stored
 * on the draft so a later 出稿 overwrites that Word instead of minting `_02`.
 */

import fs from "node:fs";
import path from "node:path";
import { renderDocxWithTrackedChanges } from "../artifacts/render-docx-tracked.js";
import {
  planTrackedWordDelivery,
  resolveWordBaselineAbs,
} from "../artifacts/word-revision-delivery.js";
import { writeVisibleTrackedEdits } from "./docx-visible-revisions.js";
import { persistDraft, readDraft } from "./index.js";
import { readRedlineProposal, type RedlineHunk } from "./redline-proposal.js";
import { qaTrackedDocxXml } from "./tracked-xml-qa.js";
import { findOpenWordReviewForBaseline, readWordReview } from "./word-review.js";

export const REVIEW_FILE_LOCKED =
  "审阅稿正被 Word 或 WPS 打开，覆盖没有写成。请先关掉那份稿再导出。这一条仍留在在办。";

export function reviewFileLockMessage(err: unknown): string | undefined {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return REVIEW_FILE_LOCKED;
  }
  const message = err instanceof Error ? err.message : "";
  if (/EBUSY|EPERM|resource busy|being used by another process/i.test(message)) {
    return REVIEW_FILE_LOCKED;
  }
  return undefined;
}

/** Preview export keeps accepted hunks only. The add-in commit still includes pending revisions. */
export function selectTrackedExportHunks(
  hunks: readonly RedlineHunk[],
  acceptedOnly: boolean,
): RedlineHunk[] {
  return hunks.filter((hunk) =>
    acceptedOnly ? hunk.status === "accepted" : hunk.status !== "rejected",
  );
}

/** Rewrite an already exported sibling from the restored draft. No file yet means wait. */
export async function refreshTrackedExportIfPresent(params: {
  workspaceDir: string;
  taskId: string;
  projectDir?: string;
}): Promise<{ refreshed: boolean }> {
  const draft = readDraft(params.workspaceDir, params.taskId);
  const output = draft?.outputPath?.trim();
  if (!output || !fs.existsSync(output)) {
    return { refreshed: false };
  }
  try {
    const result = await exportTrackedSiblingForTask({
      workspaceDir: params.workspaceDir,
      taskId: params.taskId,
      ...(params.projectDir ? { projectDir: params.projectDir } : {}),
    });
    return { refreshed: result.ok };
  } catch {
    return { refreshed: false };
  }
}

export async function exportTrackedSiblingForTask(params: {
  workspaceDir: string;
  taskId: string;
  projectDir?: string;
  /** Chat preview: do not write hunks the lawyer has not accepted. */
  acceptedOnly?: boolean;
}): Promise<
  | {
      ok: true;
      outputPath: string;
      outputFileName: string;
      mode: string;
      degraded: boolean;
      /** Present when the sibling file was checked for native w:ins/w:del. */
      trackWarning?: string;
    }
  | { ok: false; error: string; code?: string; status: 400 | 404 | 409 }
> {
  const draft = readDraft(params.workspaceDir, params.taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found", status: 404 };
  }
  const proposal = readRedlineProposal(params.workspaceDir, params.taskId);
  const proposals = selectTrackedExportHunks(proposal?.hunks ?? [], params.acceptedOnly === true);
  if (params.acceptedOnly === true && proposals.length === 0) {
    return {
      ok: false,
      error: "还没有接受的修改。预览里没决定的不会写进文件。",
      code: "nothing_accepted",
      status: 409,
    };
  }
  const ticket = readWordReview(params.workspaceDir, params.taskId);
  const baselineRel = draft.contractEdit?.baselineRelativePath?.trim();
  const sticky =
    ticket && !ticket.closedAt && ticket.reviewAbs.trim()
      ? ticket
      : baselineRel
        ? findOpenWordReviewForBaseline(params.workspaceDir, baselineRel)
        : undefined;
  const existingOutputAbs =
    sticky && !sticky.closedAt && sticky.reviewAbs.trim() ? sticky.reviewAbs : draft.outputPath;
  const planned = planTrackedWordDelivery({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    baselineRel,
    baselineRoot: draft.contractEdit?.baselineRoot,
    matterId: draft.matterId,
    fallbackBasename: `${draft.title?.trim() || "合同"}.docx`,
    existingOutputAbs,
  });
  const destPreview = path.join(planned.outDir, planned.outputFileName);
  if (fs.existsSync(destPreview)) {
    try {
      const fd = fs.openSync(destPreview, "r+");
      fs.closeSync(fd);
    } catch (err) {
      const locked = reviewFileLockMessage(err);
      if (locked) {
        return { ok: false, error: locked, code: "review_file_locked", status: 409 };
      }
    }
  }
  const preferContractReview =
    (draft.deliverableType ?? "").startsWith("contract.") || Boolean(draft.contractEdit);
  let result: Awaited<ReturnType<typeof renderDocxWithTrackedChanges>>;
  try {
    result = await renderDocxWithTrackedChanges({
      draft,
      outputDir: planned.outDir,
      proposals,
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      templateVariant: preferContractReview ? "contractReview" : undefined,
      includeProvenance: false,
      outputFileName: planned.outputFileName,
    });
  } catch (err) {
    const locked = reviewFileLockMessage(err);
    if (locked) {
      return { ok: false, error: locked, code: "review_file_locked", status: 409 };
    }
    throw err;
  }
  if (!result.ok || (proposals.length > 0 && (result.appliedHunks ?? 0) === 0)) {
    const baseline = resolveWordBaselineAbs({
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      raw: draft.contractEdit?.baselineRelativePath ?? "",
      preferredRoot: draft.contractEdit?.baselineRoot,
    });
    if (baseline) {
      const dest = path.join(planned.outDir, planned.outputFileName);
      let xml: Awaited<ReturnType<typeof writeVisibleTrackedEdits>> | null = null;
      try {
        xml = await writeVisibleTrackedEdits({
          sourceAbs: baseline.abs,
          destAbs: dest,
          hunks: proposals,
        });
      } catch (err) {
        const locked = reviewFileLockMessage(err);
        if (locked) {
          return { ok: false, error: locked, code: "review_file_locked", status: 409 };
        }
        xml = null;
      }
      if (xml && xml.applied > 0) {
        const storedXml = readDraft(params.workspaceDir, params.taskId);
        if (storedXml && storedXml.outputPath !== dest) {
          persistDraft(params.workspaceDir, { ...storedXml, outputPath: dest });
        }
        return finishTrackedExport({
          outputPath: dest,
          outputFileName: planned.outputFileName,
          mode: "docx-xml",
          degraded: xml.applied < xml.attempted,
          expectedHunks: proposals.length,
        });
      }
    }
  }
  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code, status: 400 };
  }
  const stored = readDraft(params.workspaceDir, params.taskId);
  if (stored && stored.outputPath !== result.outputPath) {
    persistDraft(params.workspaceDir, { ...stored, outputPath: result.outputPath });
  }
  return finishTrackedExport({
    outputPath: result.outputPath,
    outputFileName: planned.outputFileName,
    mode: result.mode,
    degraded: result.degraded === true,
    expectedHunks: proposals.length,
  });
}

async function finishTrackedExport(params: {
  outputPath: string;
  outputFileName: string;
  mode: string;
  degraded: boolean;
  expectedHunks: number;
}): Promise<{
  ok: true;
  outputPath: string;
  outputFileName: string;
  mode: string;
  degraded: boolean;
  trackWarning?: string;
}> {
  if (params.expectedHunks <= 0) {
    return {
      ok: true,
      outputPath: params.outputPath,
      outputFileName: params.outputFileName,
      mode: params.mode,
      degraded: params.degraded,
    };
  }
  const qa = await qaTrackedDocxXml(params.outputPath, params.expectedHunks);
  if (qa.ok) {
    return {
      ok: true,
      outputPath: params.outputPath,
      outputFileName: params.outputFileName,
      mode: params.mode,
      degraded: params.degraded,
    };
  }
  return {
    ok: true,
    outputPath: params.outputPath,
    outputFileName: params.outputFileName,
    mode: params.mode,
    degraded: true,
    ...(qa.warning ? { trackWarning: qa.warning } : {}),
  };
}

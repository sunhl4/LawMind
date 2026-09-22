/**
 * Block write_document from smuggling research deliverables past draft gates.
 */

import path from "node:path";
import { readResearchSnapshot } from "../drafts/research-snapshot.js";
import { isOutlineGatedDeliverable } from "../reasoning/research-draft-gates.js";
import { readTaskRecord } from "../tasks/index.js";
import { readResearchOutline } from "./outline-store.js";

export const RESEARCH_WRITE_BYPASS_REFUSAL =
  "请使用 draft_document（经大纲确认与证据门禁），勿用 write_document 旁路交付。";

const ARTIFACT_DELIVERY_EXTS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".docx",
  ".pptx",
  ".html",
  ".htm",
]);

function normalizeRel(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function isResearchDeliverableWritePath(relPath: string): boolean {
  const p = normalizeRel(relPath).toLowerCase();
  if (p.startsWith("artifacts/") || p.includes("/artifacts/")) {
    return true;
  }
  const ext = path.extname(p);
  if (
    (ext === ".md" || ext === ".docx" || ext === ".pptx") &&
    /(合规|调研|培训|卷宗|outline|research|esg|报告)/i.test(p)
  ) {
    return true;
  }
  return false;
}

export function shouldRefuseResearchWriteBypass(opts: {
  workspaceDir: string;
  filePath: string;
  linkedTaskId?: string;
}): { refuse: boolean; reason?: string; taskId?: string } {
  const rel = normalizeRel(opts.filePath);
  const ext = path.extname(rel).toLowerCase();
  const underArtifacts = rel.startsWith("artifacts/") || rel.includes("/artifacts/");

  // Any client-facing delivery file under artifacts/ must go through draft/render.
  if (underArtifacts && ARTIFACT_DELIVERY_EXTS.has(ext)) {
    return { refuse: true, reason: RESEARCH_WRITE_BYPASS_REFUSAL };
  }

  if (!isResearchDeliverableWritePath(opts.filePath)) {
    return { refuse: false };
  }

  const linked = opts.linkedTaskId?.trim();
  const candidates = linked ? [linked] : [];

  for (const taskId of candidates) {
    const rec = readTaskRecord(opts.workspaceDir, taskId);
    if (isOutlineGatedDeliverable(rec?.deliverableType)) {
      return {
        refuse: true,
        reason: RESEARCH_WRITE_BYPASS_REFUSAL,
        taskId,
      };
    }
    const snapshot = readResearchSnapshot(opts.workspaceDir, taskId);
    const outline = readResearchOutline(opts.workspaceDir, taskId);
    if (snapshot || outline) {
      return {
        refuse: true,
        reason: RESEARCH_WRITE_BYPASS_REFUSAL,
        taskId,
      };
    }
  }

  const m = rel.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (m?.[1]) {
    const taskId = m[1];
    const snapshot = readResearchSnapshot(opts.workspaceDir, taskId);
    const outline = readResearchOutline(opts.workspaceDir, taskId);
    const rec = readTaskRecord(opts.workspaceDir, taskId);
    if (snapshot || outline || isOutlineGatedDeliverable(rec?.deliverableType)) {
      return {
        refuse: true,
        reason: RESEARCH_WRITE_BYPASS_REFUSAL,
        taskId,
      };
    }
  }

  return { refuse: false };
}

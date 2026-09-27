/**
 * Block write_document from smuggling research deliverables past draft gates.
 */

import path from "node:path";
import { readResearchSnapshot } from "../drafts/research-snapshot.js";
import { isOutlineGatedDeliverable } from "../reasoning/research-draft-gates.js";
import { readTaskRecord } from "../tasks/index.js";
import { readResearchOutline } from "./outline-store.js";

export const RESEARCH_WRITE_BYPASS_REFUSAL =
  "请使用 draft_document（经证据门禁），勿用 write_document 旁路交付。";

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
  const underArtifacts = rel.startsWith("artifacts/") || rel.includes("/artifacts/");

  // artifacts/ 是导出落点。write_document 不按扩展名开口子：xlsx/json 同样不能旁路交付。
  // 图表、表格、分析脚本和正式导出走各自的工具，直接写文件，不经过本门。
  if (underArtifacts) {
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

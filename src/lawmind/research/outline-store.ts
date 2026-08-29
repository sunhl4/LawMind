/**
 * Persist ResearchOutline for STORM-style outline-before-write HITL.
 */

import fs from "node:fs";
import path from "node:path";
import type { ResearchOutline } from "./research-outline.js";

export function researchOutlinePath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.outline.json`);
}

export function persistResearchOutline(
  workspaceDir: string,
  taskId: string,
  outline: ResearchOutline,
): string {
  const target = researchOutlinePath(workspaceDir, taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ ...outline, taskId }, null, 2));
  return target;
}

export function readResearchOutline(
  workspaceDir: string,
  taskId: string,
): ResearchOutline | undefined {
  try {
    const raw = fs.readFileSync(researchOutlinePath(workspaceDir, taskId), "utf8");
    return JSON.parse(raw) as ResearchOutline;
  } catch {
    return undefined;
  }
}

export function approveResearchOutline(
  workspaceDir: string,
  taskId: string,
  opts?: { lawyerNotes?: string; sections?: ResearchOutline["sections"] },
): ResearchOutline | undefined {
  const current = readResearchOutline(workspaceDir, taskId);
  if (!current) {
    return undefined;
  }
  const next: ResearchOutline = {
    ...current,
    status: "approved",
    sections: opts?.sections ?? current.sections,
    notes: opts?.lawyerNotes
      ? [...current.notes, `律师确认备注：${opts.lawyerNotes}`]
      : current.notes,
  };
  persistResearchOutline(workspaceDir, taskId, next);
  return next;
}

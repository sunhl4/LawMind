/**
 * Phase D: 将审核标签触发的学习摘要追加到 `playbooks/CLAUSE_PLAYBOOK.md` 第六节，
 * 与律师档案学习并行，沉淀条款/结构类可复用经验。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ReviewLabel } from "../types.js";

/** Relative path from workspace root. */
export const CLAUSE_PLAYBOOK_RELATIVE = "playbooks/CLAUSE_PLAYBOOK.md" as const;

/** Section heading — must match numbered `## N.` pattern for section-boundary logic. */
export const PLAYBOOK_REVIEW_SECTION = "## 6. LawMind 审核学习（自动摘要）";

const TRIGGER_LABELS: ReadonlySet<ReviewLabel> = new Set([
  "citation.incomplete",
  "citation.incorrect",
  "structure.template_mismatch",
  "issue.missing",
  "issue.over_argued",
  "audience.wrong_framing",
]);

function timestampLabel(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when any label should trigger a clause-playbook learning line. */
export function reviewLabelsTriggerPlaybook(labels: ReviewLabel[]): boolean {
  return labels.some((l) => TRIGGER_LABELS.has(l));
}

/** Single-line summary for playbook section (no PII — task id + labels + optional note). */
export function buildClausePlaybookReviewLine(
  taskId: string,
  labels: ReviewLabel[],
  note?: string,
): string {
  const filtered = labels.filter((l) => TRIGGER_LABELS.has(l));
  const base = `任务 ${taskId}；labels=${filtered.join(",")}`;
  const n = note?.trim();
  return n ? `${base}；备注：${n}` : base;
}

/**
 * Append a timestamped bullet under the review section, creating the section if missing.
 */
export async function appendClausePlaybookLearning(
  workspaceDir: string,
  bullet: string,
): Promise<void> {
  const p = path.join(workspaceDir, CLAUSE_PLAYBOOK_RELATIVE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  let content = "";
  try {
    content = await fs.readFile(p, "utf8");
  } catch {
    content = "";
  }
  if (!content.trim()) {
    content = [
      "# CLAUSE_PLAYBOOK.md — 条款库与替代措辞",
      "",
      "本文件沉淀可复用的条款模式与审核学习摘要。",
      "",
      PLAYBOOK_REVIEW_SECTION,
      "",
    ].join("\n");
  }
  const next = writePlaybookSectionBullet(content, PLAYBOOK_REVIEW_SECTION, bullet.trim());
  await fs.writeFile(p, next, "utf8");
}

function writePlaybookSectionBullet(content: string, heading: string, bullet: string): string {
  const entry = `- [${timestampLabel()}] ${bullet}`;
  const headingPattern = new RegExp(`^${escapeRegex(heading)}$`, "m");
  const match = headingPattern.exec(content);

  if (!match || match.index < 0) {
    return `${content.trimEnd()}\n\n---\n\n${heading}\n\n${entry}\n`;
  }

  const insertStart = match.index + match[0].length;
  const afterHeading = content.slice(insertStart);
  const nextHeadingIndex = afterHeading.search(/\n##\s+\d+\./);
  const sectionEnd = nextHeadingIndex >= 0 ? insertStart + nextHeadingIndex + 1 : content.length;
  const sectionBody = content.slice(insertStart, sectionEnd);
  const trimmedBody = sectionBody.replace(/\s+$/g, "");

  if (trimmedBody === "" || trimmedBody === "\n-" || trimmedBody === "\n- ") {
    return `${content.slice(0, insertStart)}\n\n${entry}\n${content.slice(sectionEnd)}`;
  }

  return `${content.slice(0, sectionEnd).trimEnd()}\n${entry}\n${content.slice(sectionEnd)}`;
}

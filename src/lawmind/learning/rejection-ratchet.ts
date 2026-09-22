/**
 * Classify labeled review rejections onto the existing learning path.
 * Bare reject (no labels) writes nothing.
 */

import type { ReviewLabel, ReviewStatus } from "../types.js";
import { appendWorkEvent, findLawyerWork } from "../work/store.js";

export type RejectionRatchetClass = "playbook" | "skill" | "verify" | "template";

const VERIFY_LABELS = new Set<ReviewLabel>(["引用有误", "引用不完整"]);
const TEMPLATE_LABELS = new Set<ReviewLabel>(["模板不匹配"]);
const SKILL_LABELS = new Set<ReviewLabel>(["语气过强", "语气过弱", "受众定位不当"]);

export function classifyRejectionLabels(
  labels: readonly ReviewLabel[],
): RejectionRatchetClass | null {
  if (labels.length === 0) {
    return null;
  }
  if (labels.some((label) => VERIFY_LABELS.has(label))) {
    return "verify";
  }
  if (labels.some((label) => TEMPLATE_LABELS.has(label))) {
    return "template";
  }
  if (labels.some((label) => SKILL_LABELS.has(label))) {
    return "skill";
  }
  return "playbook";
}

export function recordRejectionRatchet(opts: {
  workspaceDir: string;
  taskId: string;
  status: ReviewStatus;
  labels: readonly ReviewLabel[];
  note?: string;
}): { class: RejectionRatchetClass; workId: string } | null {
  if (opts.status !== "rejected" && opts.status !== "modified") {
    return null;
  }
  const klass = classifyRejectionLabels(opts.labels);
  if (!klass) {
    return null;
  }
  const work = findLawyerWork(opts.workspaceDir, { taskId: opts.taskId });
  if (!work) {
    return null;
  }
  appendWorkEvent(opts.workspaceDir, work.workId, {
    type: "rejection_ratchet",
    class: klass,
    labels: [...opts.labels],
    note: opts.note?.trim() || undefined,
    taskId: opts.taskId,
  });
  return { class: klass, workId: work.workId };
}

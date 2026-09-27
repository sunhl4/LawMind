/**
 * Classify labeled review rejections onto the existing learning path.
 * Bare reject (no labels) writes nothing.
 */

import fs from "node:fs";
import type { ReviewLabel, ReviewStatus } from "../types.js";
import { appendWorkEvent, findLawyerWork, workEventsPath } from "../work/store.js";

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

const REJECTION_COACH: Record<RejectionRatchetClass, string> = {
  verify: "先核对引用是否对应原文和现行条文，再改表述。",
  template: "先对照律师指定的文书结构，再填内容。",
  skill: "先调整语气和受众，不必重写法律结论。",
  playbook: "先按驳回说明补强论证。",
};

const REJECTION_CLASS_LABEL: Record<RejectionRatchetClass, string> = {
  verify: "引用核对",
  template: "文书结构",
  skill: "语气与受众",
  playbook: "论证补强",
};

/** 同一任务的最近一次带标签驳回。只作下一轮软提示，不锁工具、不改写稿。 */
export function formatRejectionCoach(
  workspaceDir: string,
  taskId: string | undefined,
): string | undefined {
  const id = taskId?.trim();
  if (!id) {
    return undefined;
  }
  const work = findLawyerWork(workspaceDir, { taskId: id });
  if (!work) {
    return undefined;
  }
  let raw = "";
  try {
    raw = fs.readFileSync(workEventsPath(workspaceDir, work.workId), "utf8");
  } catch {
    return undefined;
  }
  let latest: RejectionRatchetClass | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { type?: string; class?: string };
      if (parsed.type !== "rejection_ratchet") {
        continue;
      }
      if (
        parsed.class === "verify" ||
        parsed.class === "template" ||
        parsed.class === "skill" ||
        parsed.class === "playbook"
      ) {
        latest = parsed.class;
      }
    } catch {
      // 坏行跳过，不影响后续事件。
    }
  }
  if (!latest) {
    return undefined;
  }
  return [
    `本任务上次审核未通过（归类：${REJECTION_CLASS_LABEL[latest]}）。${REJECTION_COACH[latest]}`,
    "这是审核记录，不是新的禁写规则；与本条律师指令冲突时以指令为准。",
  ].join("");
}

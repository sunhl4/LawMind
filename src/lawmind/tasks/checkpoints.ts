/**
 * Derive human-readable pipeline checkpoints from a persisted TaskRecord (no extra storage).
 */

import type { TaskLifecycleStatus, TaskRecord } from "../types.js";

export type TaskCheckpoint = {
  /** Stable id for UI keys */
  id: string;
  /** Short Chinese label */
  label: string;
  /** Whether this stage has been reached per current record.status */
  reached: boolean;
};

const STATUS_ORDER: TaskLifecycleStatus[] = [
  "created",
  "confirmed",
  "researching",
  "researched",
  "drafted",
  "reviewed",
  "rendered",
  "completed",
];

function statusIndex(status: TaskLifecycleStatus): number {
  const i = STATUS_ORDER.indexOf(status);
  if (i >= 0) {
    return i;
  }
  if (status === "rejected") {
    return STATUS_ORDER.indexOf("drafted");
  }
  return 0;
}

function listEngineTaskCheckpoints(record: TaskRecord): TaskCheckpoint[] {
  const idx = statusIndex(record.status);
  const rank = (s: TaskLifecycleStatus): number => statusIndex(s);

  const needConfirm = record.requiresConfirmation;
  const confirmReached = !needConfirm || idx >= rank("confirmed");

  return [
    { id: "planned", label: "任务已创建", reached: idx >= rank("created") },
    {
      id: "confirmed",
      label: needConfirm ? "律师已确认" : "确认（本任务不需要）",
      reached: confirmReached,
    },
    { id: "researched", label: "检索完成", reached: idx >= rank("researched") },
    { id: "drafted", label: "草稿已生成", reached: idx >= rank("drafted") },
    {
      id: "reviewed",
      label: record.status === "rejected" ? "审核已驳回" : "草稿已审核",
      reached: record.status === "rejected" || idx >= rank("reviewed"),
    },
    {
      id: "rendered",
      label: "已渲染交付",
      reached: idx >= rank("rendered") || record.status === "completed",
    },
  ];
}

/**
 * Linear milestones aligned with engine lifecycle + task record `status`.
 * Agent chat-only tasks use a shorter two-step list.
 */
export function listTaskCheckpoints(record: TaskRecord): TaskCheckpoint[] {
  if (record.kind === "agent.instruction") {
    return [
      { id: "logged", label: "对话指令已记录", reached: true },
      { id: "done", label: "回合已完成", reached: record.status === "completed" },
    ];
  }

  return listEngineTaskCheckpoints(record);
}

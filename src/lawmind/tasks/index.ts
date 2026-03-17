/**
 * Task lifecycle persistence.
 *
 * 目标：
 * - 把关键任务状态写入 workspace/tasks/*.json
 * - 便于下次登录恢复上下文，而不依赖瞬时会话
 */

import fs from "node:fs";
import path from "node:path";
import type { ArtifactDraft, TaskIntent, TaskLifecycleStatus, TaskRecord } from "../types.js";

function tasksDir(workspaceDir: string): string {
  return path.join(workspaceDir, "tasks");
}

export function taskRecordPath(workspaceDir: string, taskId: string): string {
  return path.join(tasksDir(workspaceDir), `${taskId}.json`);
}

function persistTaskRecord(workspaceDir: string, record: TaskRecord): TaskRecord {
  fs.mkdirSync(tasksDir(workspaceDir), { recursive: true });
  fs.writeFileSync(taskRecordPath(workspaceDir, record.taskId), JSON.stringify(record, null, 2));
  return record;
}

export function readTaskRecord(workspaceDir: string, taskId: string): TaskRecord | undefined {
  try {
    const content = fs.readFileSync(taskRecordPath(workspaceDir, taskId), "utf8");
    return JSON.parse(content) as TaskRecord;
  } catch {
    return undefined;
  }
}

export function listTaskRecords(workspaceDir: string): TaskRecord[] {
  try {
    const dir = tasksDir(workspaceDir);
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .toSorted();
    return files
      .map((name) => {
        try {
          const content = fs.readFileSync(path.join(dir, name), "utf8");
          return JSON.parse(content) as TaskRecord;
        } catch {
          return undefined;
        }
      })
      .filter((record): record is TaskRecord => Boolean(record))
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function ensureTaskRecord(
  workspaceDir: string,
  intent: TaskIntent,
): { record: TaskRecord; created: boolean } {
  const existing = readTaskRecord(workspaceDir, intent.taskId);
  if (existing) {
    return { record: existing, created: false };
  }

  const record: TaskRecord = {
    taskId: intent.taskId,
    kind: intent.kind,
    summary: intent.summary,
    output: intent.output,
    riskLevel: intent.riskLevel,
    requiresConfirmation: intent.requiresConfirmation,
    audience: intent.audience,
    matterId: intent.matterId,
    templateId: intent.templateId,
    status: "created",
    createdAt: intent.createdAt,
    updatedAt: intent.createdAt,
  };

  return { record: persistTaskRecord(workspaceDir, record), created: true };
}

export function updateTaskRecord(
  workspaceDir: string,
  taskId: string,
  patch: Partial<Omit<TaskRecord, "taskId" | "createdAt">>,
): TaskRecord | undefined {
  const current = readTaskRecord(workspaceDir, taskId);
  if (!current) {
    return undefined;
  }

  const next: TaskRecord = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  return persistTaskRecord(workspaceDir, next);
}

export function syncDraftToTaskRecord(
  workspaceDir: string,
  draft: ArtifactDraft,
  status: Extract<TaskLifecycleStatus, "drafted" | "reviewed" | "rejected" | "rendered">,
): TaskRecord | undefined {
  return updateTaskRecord(workspaceDir, draft.taskId, {
    status,
    templateId: draft.templateId,
    reviewStatus: draft.reviewStatus,
    outputPath: draft.outputPath,
  });
}

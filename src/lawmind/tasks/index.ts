/**
 * Task lifecycle persistence.
 *
 * 目标：
 * - 把关键任务状态写入 workspace/tasks/*.json
 * - 便于下次登录恢复上下文，而不依赖瞬时会话
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, withExclusiveFileLock } from "../adapters/matter-storage/io.js";
import type { ArtifactDraft, TaskIntent, TaskLifecycleStatus, TaskRecord } from "../types.js";
import { upsertLawyerWorkFromPersist } from "../work/store.js";
import {
  buildInitialExecutionPlan,
  buildInitialExecutionPlanFromRecord,
} from "./execution-plan.js";

function tasksDir(workspaceDir: string): string {
  return path.join(workspaceDir, "tasks");
}

export function taskRecordPath(workspaceDir: string, taskId: string): string {
  return path.join(tasksDir(workspaceDir), `${taskId}.json`);
}

function taskRecordLockPath(workspaceDir: string, taskId: string): string {
  return path.join(tasksDir(workspaceDir), `${taskId}.json.lock`);
}

/** 原子写（temp+rename），避免崩溃留下半写 JSON。 */
function persistTaskRecord(workspaceDir: string, record: TaskRecord): TaskRecord {
  writeJsonAtomic(taskRecordPath(workspaceDir, record.taskId), record);
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

/** Remove a task JSON file. Returns true if a file was deleted. */
export function deleteTaskRecord(workspaceDir: string, taskId: string): boolean {
  const id = taskId.trim();
  if (!id) {
    return false;
  }
  const p = taskRecordPath(workspaceDir, id);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
  } catch {
    /* best-effort */
  }
  return false;
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
  opts?: { assistantId?: string },
): { record: TaskRecord; created: boolean } {
  return withExclusiveFileLock(taskRecordLockPath(workspaceDir, intent.taskId), () => {
    const existing = readTaskRecord(workspaceDir, intent.taskId);
    if (existing) {
      if (!existing.executionPlan?.length) {
        return {
          record: persistTaskRecord(workspaceDir, {
            ...existing,
            executionPlan: buildInitialExecutionPlanFromRecord(existing),
            updatedAt: new Date().toISOString(),
          }),
          created: false,
        };
      }
      if (opts?.assistantId && !existing.assistantId) {
        return {
          record: persistTaskRecord(workspaceDir, {
            ...existing,
            assistantId: opts.assistantId,
            updatedAt: new Date().toISOString(),
          }),
          created: false,
        };
      }
      return { record: existing, created: false };
    }

    const record: TaskRecord = {
      taskId: intent.taskId,
      kind: intent.kind,
      instruction: intent.instruction,
      summary: intent.summary,
      output: intent.output,
      riskLevel: intent.riskLevel,
      requiresConfirmation: intent.requiresConfirmation,
      audience: intent.audience,
      matterId: intent.matterId,
      templateId: intent.templateId,
      deliverableType: intent.deliverableType,
      acceptanceCriteria: intent.acceptanceCriteria,
      clarificationQuestions: intent.clarificationQuestions,
      status: "created",
      createdAt: intent.createdAt,
      updatedAt: intent.createdAt,
      executionPlan: buildInitialExecutionPlan(intent),
      ...(opts?.assistantId ? { assistantId: opts.assistantId } : {}),
    };

    return { record: persistTaskRecord(workspaceDir, record), created: true };
  });
}

export function updateTaskRecord(
  workspaceDir: string,
  taskId: string,
  patch: Partial<Omit<TaskRecord, "taskId" | "createdAt">>,
): TaskRecord | undefined {
  // per-task 排他锁包住读-改-写：并行 update（如 update_draft 与 review 同发）不丢字段。
  return withExclusiveFileLock(taskRecordLockPath(workspaceDir, taskId), () => {
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
  });
}

export function syncDraftToTaskRecord(
  workspaceDir: string,
  draft: ArtifactDraft,
  status: Extract<TaskLifecycleStatus, "drafted" | "reviewed" | "rejected" | "rendered">,
): TaskRecord | undefined {
  return updateTaskRecord(workspaceDir, draft.taskId, {
    status,
    templateId: draft.templateId,
    templateVersion: draft.templateVersion,
    reviewStatus: draft.reviewStatus,
    outputPath: draft.outputPath,
  });
}

/** Max chars stored in TaskRecord.summary for agent instruction tasks */
export const MAX_AGENT_INSTRUCTION_SUMMARY_CHARS = 4000;

/**
 * Short display title from user instruction (deterministic, no LLM).
 */
export { listTaskCheckpoints, type TaskCheckpoint } from "./checkpoints.js";
export {
  buildInitialExecutionPlan,
  buildInitialExecutionPlanFromRecord,
  deriveExecutionPlanSteps,
} from "./execution-plan.js";
export { taskIntentFromRecord, taskIntentFromRecordOnly } from "./task-intent.js";

export function deriveInstructionTitle(instruction: string, maxLen = 56): string {
  const collapsed = instruction
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const s = collapsed.replace(/\s+/g, " ").trim();
  if (!s) {
    return "（空指令）";
  }
  if (s.length <= maxLen) {
    return s;
  }
  return `${s.slice(0, Math.max(1, maxLen - 1))}…`;
}

/**
 * Persist one TaskRecord per successful Agent turn (desktop + CLI).
 * taskId is the Agent turn id (UUID).
 */
export function persistAgentInstructionTask(
  workspaceDir: string,
  params: {
    taskId: string;
    instruction: string;
    sessionId: string;
    matterId?: string;
    assistantId?: string;
  },
): TaskRecord {
  const now = new Date().toISOString();
  const raw = params.instruction;
  const summary =
    raw.length > MAX_AGENT_INSTRUCTION_SUMMARY_CHARS
      ? `${raw.slice(0, MAX_AGENT_INSTRUCTION_SUMMARY_CHARS)}…`
      : raw;

  const record: TaskRecord = {
    taskId: params.taskId,
    kind: "agent.instruction",
    instruction: raw,
    summary,
    output: "none",
    riskLevel: "low",
    requiresConfirmation: false,
    matterId: params.matterId,
    title: deriveInstructionTitle(raw),
    status: "completed",
    createdAt: now,
    updatedAt: now,
    assistantId: params.assistantId,
    sessionId: params.sessionId,
    sourceTurnId: params.taskId,
    executionPlan: buildInitialExecutionPlan({
      taskId: params.taskId,
      kind: "agent.instruction",
      output: "none",
      instruction: raw,
      summary,
      riskLevel: "low",
      requiresConfirmation: false,
      createdAt: now,
      models: [],
      matterId: params.matterId,
    }),
  };

  const saved = persistTaskRecord(workspaceDir, record);
  upsertLawyerWorkFromPersist(workspaceDir, {
    taskId: saved.taskId,
    sessionId: params.sessionId,
    matterId: params.matterId,
    title: saved.title,
    status: "running",
    source: "chat",
  });
  return saved;
}

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
  opts?: { assistantId?: string },
): { record: TaskRecord; created: boolean } {
  const existing = readTaskRecord(workspaceDir, intent.taskId);
  if (existing) {
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
    ...(opts?.assistantId ? { assistantId: opts.assistantId } : {}),
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

/** Max chars stored in TaskRecord.summary for agent instruction tasks */
export const MAX_AGENT_INSTRUCTION_SUMMARY_CHARS = 4000;

/**
 * Short display title from user instruction (deterministic, no LLM).
 */
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
  };

  return persistTaskRecord(workspaceDir, record);
}

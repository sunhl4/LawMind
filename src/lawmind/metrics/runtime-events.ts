/**
 * Runtime events for north-star metrics (task 1 P1).
 *
 * These events are emitted by the engine / agent at execution time and stored
 * under workspace/lawmind/metrics/runtime-events.jsonl.  They are kept separate
 * from the derived product-metrics so that:
 *   - north-star.ts can continue to use the existing product-events aggregation
 *     without being disrupted;
 *   - future consumers can join runtime events to product metrics by eventId.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RuntimeEventKind = "tool_call" | "lint_run" | "lawyer_edit" | "deliver";

export type RuntimeEventMeta = Record<
  string,
  string | number | boolean | null | string[] | undefined
>;

export type RuntimeEvent = {
  eventId: string;
  ts: string;
  kind: RuntimeEventKind;
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  meta?: RuntimeEventMeta;
};

export function runtimeEventsPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "metrics", "runtime-events.jsonl");
}

export function appendRuntimeEvent(
  workspaceDir: string,
  event: Omit<RuntimeEvent, "eventId" | "ts">,
): RuntimeEvent {
  const dir = path.dirname(runtimeEventsPath(workspaceDir));
  fs.mkdirSync(dir, { recursive: true });
  const row: RuntimeEvent = { ...event, eventId: randomUUID(), ts: new Date().toISOString() };
  fs.appendFileSync(runtimeEventsPath(workspaceDir), `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listRuntimeEvents(workspaceDir: string, limit = 5000): RuntimeEvent[] {
  const file = runtimeEventsPath(workspaceDir);
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const events: RuntimeEvent[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      events.push(JSON.parse(line) as RuntimeEvent);
    } catch {
      /* skip malformed lines */
    }
  }
  return events;
}

export function readRuntimeEventById(
  workspaceDir: string,
  eventId: string,
): RuntimeEvent | undefined {
  return listRuntimeEvents(workspaceDir).find((e) => e.eventId === eventId);
}

// ─────────────────────────────────────────────
// Convenience recorders
// ─────────────────────────────────────────────

export type ToolCallRuntimeEventInput = {
  toolName: string;
  toolCallId: string;
  roundIndex: number;
  approvalRequired: boolean;
  resultStatus: "ok" | "error" | "aborted" | "skipped";
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
};

export function recordToolCallEvent(
  workspaceDir: string,
  input: ToolCallRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "tool_call",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      roundIndex: input.roundIndex,
      approvalRequired: input.approvalRequired,
      resultStatus: input.resultStatus,
    },
  });
}

export type LintRunRuntimeEventInput = {
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  ruleIds: string[];
  failCount: number;
  blockerCount: number;
  warningCount: number;
};

export function recordLintRunEvent(
  workspaceDir: string,
  input: LintRunRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "lint_run",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      ruleIds: input.ruleIds,
      failCount: input.failCount,
      blockerCount: input.blockerCount,
      warningCount: input.warningCount,
    },
  });
}

export type LawyerEditRuntimeEventInput = {
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  outcome: "approved" | "modified" | "rejected";
  lintEscape: boolean;
  note?: string;
};

export function recordLawyerEditEvent(
  workspaceDir: string,
  input: LawyerEditRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "lawyer_edit",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      outcome: input.outcome,
      lintEscape: input.lintEscape,
      ...(input.note ? { note: input.note } : {}),
    },
  });
}

export type DeliverRuntimeEventInput = {
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  firstPass: boolean;
  lintEscape: boolean;
  outputPath?: string;
};

export function recordDeliverEvent(
  workspaceDir: string,
  input: DeliverRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "deliver",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      firstPass: input.firstPass,
      lintEscape: input.lintEscape,
      ...(input.outputPath ? { outputPath: input.outputPath } : {}),
    },
  });
}

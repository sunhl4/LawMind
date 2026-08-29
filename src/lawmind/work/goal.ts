/**
 * 本件目标 — sidecar claim, same timing as pin/steer.
 * Does not auto-continue a turn.
 */

import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { AgentSession } from "../agent/types.js";
import { parseCapabilityLock } from "../skills/lawyer-capability-lock.js";
import { findLawyerWork, upsertLawyerWork, workRecordPath } from "./store.js";

const MAX_GOAL_CHARS = 200;

export function pendingWorkGoalPath(workspaceDir: string, workId: string): string {
  return `${workRecordPath(workspaceDir, workId).slice(0, -".json".length)}.pending-goal.json`;
}

export function goalFromInstruction(instruction: string, maxLen = 80): string {
  for (const line of instruction.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    if (
      t.startsWith("【") &&
      (t.includes("LawMind") || t.includes("文件页") || t.includes("会议议程"))
    ) {
      continue;
    }
    if (t === "---" || t.startsWith("---")) {
      continue;
    }
    if (t.startsWith("- [") && (t.includes("工作区") || t.includes("项目"))) {
      continue;
    }
    return t.length <= maxLen ? t : `${t.slice(0, Math.max(1, maxLen - 1))}…`;
  }
  return "";
}

export function normalizeWorkGoal(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_GOAL_CHARS);
}

export function formatWorkGoalUserMessage(goal: string): string {
  return `【本件目标】${goal}`;
}

export function queueWorkGoal(
  workspaceDir: string,
  workId: string,
  text: string,
): { queued: boolean; goal: string } {
  const goal = normalizeWorkGoal(text);
  const filePath = pendingWorkGoalPath(workspaceDir, workId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomic(filePath, { goal, updatedAt: new Date().toISOString() });
    return { queued: goal.length > 0, goal };
  });
}

export function claimPendingWorkGoal(workspaceDir: string, workId: string): string | null {
  const filePath = pendingWorkGoalPath(workspaceDir, workId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    let goal: string | null = null;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { goal?: unknown };
      if (typeof raw.goal === "string" && raw.goal.trim()) {
        goal = normalizeWorkGoal(raw.goal);
      }
    } catch {
      goal = null;
    }
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* best-effort */
    }
    return goal;
  });
}

export function setLawyerWorkGoal(
  workspaceDir: string,
  workId: string,
  text: string,
): { workId: string; goal: string } {
  const goal = normalizeWorkGoal(text);
  upsertLawyerWork(workspaceDir, { workId, goal });
  queueWorkGoal(workspaceDir, workId, goal);
  return { workId, goal };
}

export function applyClaimedWorkGoalToHistory(session: AgentSession, goal: string): boolean {
  const note = goal.trim();
  if (!note) {
    return false;
  }
  session.conversationHistory.push({
    role: "user",
    content: formatWorkGoalUserMessage(note),
    timestamp: new Date().toISOString(),
  });
  return true;
}

export function claimAndApplyWorkGoal(session: AgentSession, workspaceDir: string): string | null {
  const work = findLawyerWork(workspaceDir, { sessionId: session.sessionId });
  if (!work) {
    return null;
  }
  const goal = claimPendingWorkGoal(workspaceDir, work.workId);
  if (!goal) {
    return null;
  }
  applyClaimedWorkGoalToHistory(session, goal);
  return goal;
}

export function ensureLawyerWorkForTurn(opts: {
  workspaceDir: string;
  sessionId: string;
  instruction: string;
  matterId?: string;
  source?: "chat" | "file";
}): void {
  const goal = goalFromInstruction(opts.instruction);
  const existing = findLawyerWork(opts.workspaceDir, { sessionId: opts.sessionId });
  if (existing) {
    if (!existing.goal && goal) {
      setLawyerWorkGoal(opts.workspaceDir, existing.workId, goal);
    }
    return;
  }
  const created = upsertLawyerWork(opts.workspaceDir, {
    sessionId: opts.sessionId,
    matterId: opts.matterId,
    title: goal || "本件",
    goal,
    status: "running",
    source: opts.source ?? "chat",
    capabilityId: parseCapabilityLock(opts.instruction),
  });
  if (goal) {
    queueWorkGoal(opts.workspaceDir, created.workId, goal);
  }
}

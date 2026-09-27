/**
 * 采信纸的读取与律师标记。标记单独落盘，不改草稿正文。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { loadSession } from "../agent/session.js";
import type { AgentMessage } from "../agent/types.js";
import { readReviewTable } from "../deliverables/review-table.js";
import { readDraft } from "../drafts/index.js";
import { readResearchSnapshot } from "../drafts/research-snapshot.js";
import {
  type AcceptanceChartView,
  type AcceptanceMark,
  type AcceptanceMarksFile,
  type AcceptanceSheet,
  acceptanceChartsFromToolData,
  buildAcceptanceSheet,
  isAcceptanceTaskId,
} from "./model.js";

const TASK_TOOLS = new Set([
  "research_task",
  "draft_document",
  "execute_workflow",
  "update_draft",
  "render_document",
  "review_table_update",
]);

export function acceptanceMarksPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.acceptance.json`);
}

export function readAcceptanceMarks(
  workspaceDir: string,
  taskId: string,
): Record<string, AcceptanceMark> {
  try {
    const raw = JSON.parse(
      fs.readFileSync(acceptanceMarksPath(workspaceDir, taskId), "utf8"),
    ) as AcceptanceMarksFile;
    if (!raw || raw.taskId !== taskId || !raw.marks || typeof raw.marks !== "object") {
      return {};
    }
    const marks: Record<string, AcceptanceMark> = {};
    for (const [id, mark] of Object.entries(raw.marks)) {
      if (mark === "accepted" || mark === "too_strong" || mark === "removed") {
        marks[id] = mark;
      }
    }
    return marks;
  } catch {
    return {};
  }
}

function writeMarks(
  workspaceDir: string,
  taskId: string,
  marks: Record<string, AcceptanceMark>,
): void {
  const file: AcceptanceMarksFile = {
    taskId,
    marks,
    updatedAt: new Date().toISOString(),
  };
  const target = acceptanceMarksPath(workspaceDir, taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeJsonAtomic(target, file);
}

export function loadAcceptanceSheet(workspaceDir: string, taskId: string): AcceptanceSheet | null {
  if (!isAcceptanceTaskId(taskId)) {
    return null;
  }
  const bundle = readResearchSnapshot(workspaceDir, taskId);
  const draft = readDraft(workspaceDir, taskId);
  const table = readReviewTable(workspaceDir, taskId);
  if (!bundle && !draft && !table) {
    return null;
  }
  return buildAcceptanceSheet({
    taskId,
    bundle,
    draft,
    table,
    marks: readAcceptanceMarks(workspaceDir, taskId),
  });
}

function taskIdFromTool(message: AgentMessage): string[] {
  const ids: string[] = [];
  const responses = message.toolCallResponses ?? [];
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    if (!response || !TASK_TOOLS.has(response.name) || !response.result.ok) {
      continue;
    }
    const data = response.result.data;
    if (!data || typeof data !== "object") {
      continue;
    }
    const taskId = (data as { taskId?: unknown }).taskId;
    if (typeof taskId === "string" && isAcceptanceTaskId(taskId)) {
      ids.push(taskId);
    }
  }
  return ids;
}

/** 越靠前越优先：显式 task、再从会话末尾往前找工具结果。 */
export function acceptanceTaskCandidates(
  messages: readonly AgentMessage[],
  explicitTaskId?: string,
): string[] {
  const ids: string[] = [];
  const explicit = explicitTaskId?.trim();
  if (explicit && isAcceptanceTaskId(explicit)) {
    ids.push(explicit);
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) {
      continue;
    }
    ids.push(...taskIdFromTool(message));
    const linked = message.executionState?.linkedTaskId?.trim();
    if (linked && isAcceptanceTaskId(linked)) {
      ids.push(linked);
    }
  }
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

const CHART_TOOLS = new Set(["render_chart", "run_compute"]);

/** 只取最近一次出图。这次图没有来源文件时，不往前翻旧图。 */
export function latestSourcedCharts(messages: readonly AgentMessage[]): AcceptanceChartView[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const responses = messages[i]?.toolCallResponses ?? [];
    let sawChart = false;
    const charts: AcceptanceChartView[] = [];
    for (const response of responses) {
      if (!response || !CHART_TOOLS.has(response.name) || !response.result.ok) {
        continue;
      }
      sawChart = true;
      for (const chart of acceptanceChartsFromToolData(response.name, response.result.data)) {
        if (!charts.some((existing) => existing.id === chart.id)) {
          charts.push(chart);
        }
      }
    }
    if (sawChart) {
      return charts.slice(0, 4);
    }
  }
  return [];
}

function withCharts(sheet: AcceptanceSheet, charts: AcceptanceChartView[]): AcceptanceSheet {
  if (charts.length === 0) {
    return sheet;
  }
  return { ...sheet, charts };
}

export function resolveAcceptanceSheet(
  workspaceDir: string,
  sessionId: string,
  explicitTaskId?: string,
): AcceptanceSheet | null {
  const session = loadSession(workspaceDir, sessionId);
  if (!session) {
    return null;
  }
  const charts = latestSourcedCharts(session.conversationHistory);
  const fromChat = acceptanceTaskCandidates(session.conversationHistory);
  for (const taskId of fromChat) {
    const sheet = loadAcceptanceSheet(workspaceDir, taskId);
    if (sheet?.open) {
      return withCharts(sheet, charts);
    }
  }
  const explicit = explicitTaskId?.trim();
  if (explicit && isAcceptanceTaskId(explicit) && !fromChat.includes(explicit)) {
    const pinned = loadAcceptanceSheet(workspaceDir, explicit);
    if (pinned?.open) {
      return withCharts(pinned, charts);
    }
  }
  if (charts.length > 0) {
    return buildAcceptanceSheet({ taskId: "session-chart", charts });
  }
  return null;
}

export type AcceptanceMarkWrite =
  | { ok: true; sheet: AcceptanceSheet }
  | { ok: false; error: "not_found" | "unknown_claim" };

export function applyAcceptanceMark(
  workspaceDir: string,
  taskId: string,
  claimId: string,
  mark: AcceptanceMark | null,
): AcceptanceMarkWrite {
  const current = loadAcceptanceSheet(workspaceDir, taskId);
  if (!current) {
    return { ok: false, error: "not_found" };
  }
  if (!current.claims.some((claim) => claim.id === claimId)) {
    return { ok: false, error: "unknown_claim" };
  }
  const marks = readAcceptanceMarks(workspaceDir, taskId);
  if (mark) {
    marks[claimId] = mark;
  } else {
    delete marks[claimId];
  }
  writeMarks(workspaceDir, taskId, marks);
  const sheet = loadAcceptanceSheet(workspaceDir, taskId);
  if (!sheet) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, sheet };
}

export function restoreRemovedAcceptanceMarks(
  workspaceDir: string,
  taskId: string,
): AcceptanceMarkWrite {
  const current = loadAcceptanceSheet(workspaceDir, taskId);
  if (!current) {
    return { ok: false, error: "not_found" };
  }
  const marks = readAcceptanceMarks(workspaceDir, taskId);
  for (const claim of current.claims) {
    if (marks[claim.id] === "removed") {
      delete marks[claim.id];
    }
  }
  writeMarks(workspaceDir, taskId, marks);
  const sheet = loadAcceptanceSheet(workspaceDir, taskId);
  if (!sheet) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, sheet };
}

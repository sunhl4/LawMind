/**
 * Per-matter team meeting transcript (JSONL under cases/<matterId>/).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isValidMatterId } from "./matter-id.js";

export type TeamMeetingLineKind = "user" | "assistant" | "system";

export type TeamMeetingLine = {
  id: string;
  ts: string;
  kind: TeamMeetingLineKind;
  text: string;
  assistantId?: string;
  displayName?: string;
  taskId?: string;
  sessionId?: string;
  delegationId?: string;
};

const TEAM_MEETING_FILENAME = "team-meeting.jsonl";
export const TEAM_MEETING_MAX_LINE_TEXT = 48_000;
export const TEAM_MEETING_TAIL_LIMIT_DEFAULT = 80;
export const TEAM_MEETING_TAIL_LIMIT_CAP = 200;
export const TEAM_MEETING_TRANSCRIPT_MAX_CHARS = 12_000;
const TEAM_MEETING_READ_MAX_BYTES = 4 * 1024 * 1024;

function resolvedMatterCaseDir(workspaceDir: string, matterId: string): string {
  const casesRoot = path.resolve(workspaceDir, "cases");
  const target = path.resolve(casesRoot, matterId);
  const rel = path.relative(casesRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new Error("invalid matter path");
  }
  return target;
}

export function teamMeetingFilePath(workspaceDir: string, matterId: string): string {
  if (!isValidMatterId(matterId)) {
    throw new Error("invalid matter id");
  }
  return path.join(resolvedMatterCaseDir(workspaceDir, matterId), TEAM_MEETING_FILENAME);
}

function parseLine(raw: string): TeamMeetingLine | null {
  const line = raw.trim();
  if (!line) {
    return null;
  }
  try {
    const o = JSON.parse(line) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const ts = typeof o.ts === "string" ? o.ts : "";
    const kind = o.kind === "user" || o.kind === "assistant" || o.kind === "system" ? o.kind : null;
    const text = typeof o.text === "string" ? o.text : "";
    if (!id || !ts || !kind || !text) {
      return null;
    }
    const row: TeamMeetingLine = { id, ts, kind, text: text.slice(0, TEAM_MEETING_MAX_LINE_TEXT) };
    if (typeof o.assistantId === "string") {
      row.assistantId = o.assistantId;
    }
    if (typeof o.displayName === "string") {
      row.displayName = o.displayName;
    }
    if (typeof o.taskId === "string") {
      row.taskId = o.taskId;
    }
    if (typeof o.sessionId === "string") {
      row.sessionId = o.sessionId;
    }
    if (typeof o.delegationId === "string") {
      row.delegationId = o.delegationId;
    }
    return row;
  } catch {
    return null;
  }
}

/**
 * Read entire file (bounded by byte cap), return parsed lines in order.
 */
export function readTeamMeetingLines(workspaceDir: string, matterId: string): TeamMeetingLine[] {
  const filePath = teamMeetingFilePath(workspaceDir, matterId);
  let buf: Buffer;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > TEAM_MEETING_READ_MAX_BYTES) {
      return [];
    }
    buf = fs.readFileSync(filePath);
  } catch {
    return [];
  }
  const raw = buf.toString("utf8");
  const lines: TeamMeetingLine[] = [];
  for (const segment of raw.split("\n")) {
    const row = parseLine(segment);
    if (row) {
      lines.push(row);
    }
  }
  return lines;
}

/**
 * Read a chronological window of lines ending before `skipFromEnd` lines from the file tail.
 * Example: skipFromEnd=0 returns the newest `limit` lines; skipFromEnd=120 returns the 120 lines just older than those.
 */
export function readTeamMeetingWindow(
  workspaceDir: string,
  matterId: string,
  limit: number,
  skipFromEnd = 0,
): { lines: TeamMeetingLine[]; total: number } {
  const capped = Math.min(Math.max(1, limit), TEAM_MEETING_TAIL_LIMIT_CAP);
  const skip = Math.max(0, Math.floor(skipFromEnd));
  const all = readTeamMeetingLines(workspaceDir, matterId);
  const total = all.length;
  const end = Math.max(0, total - skip);
  const start = Math.max(0, end - capped);
  return { lines: all.slice(start, end), total };
}

export function readTeamMeetingTail(
  workspaceDir: string,
  matterId: string,
  limit: number,
): TeamMeetingLine[] {
  return readTeamMeetingWindow(workspaceDir, matterId, limit, 0).lines;
}

/**
 * Build prompt prefix from tail lines, newest context last; trim by character budget from the end.
 */
export function formatTeamMeetingTranscriptPrefix(lines: TeamMeetingLine[]): string {
  if (lines.length === 0) {
    return "";
  }
  const parts: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = lines[i];
    const label =
      row.kind === "user"
        ? "用户"
        : row.kind === "system"
          ? "系统"
          : row.displayName?.trim() || row.assistantId?.trim() || "助手";
    const line = `[${label}] ${row.text.trim()}`;
    const nextLen = line.length + (parts.length > 0 ? 1 : 0);
    if (used + nextLen > TEAM_MEETING_TRANSCRIPT_MAX_CHARS) {
      break;
    }
    parts.unshift(line);
    used += nextLen;
  }
  if (parts.length === 0) {
    return "";
  }
  return [
    "## 案件团队会议室纪要（内部协作用，非对外法律意见）",
    "下列为本次会议线程近期发言摘要，请在此基础上继续讨论或执行。",
    "",
    ...parts,
  ].join("\n");
}

export function appendTeamMeetingLinesSync(
  workspaceDir: string,
  matterId: string,
  rows: TeamMeetingLine[],
): void {
  if (rows.length === 0) {
    return;
  }
  const dir = resolvedMatterCaseDir(workspaceDir, matterId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, TEAM_MEETING_FILENAME);
  const chunk =
    rows
      .map((row) =>
        JSON.stringify({
          ...row,
          text: row.text.slice(0, TEAM_MEETING_MAX_LINE_TEXT),
        }),
      )
      .join("\n") + "\n";
  fs.appendFileSync(filePath, chunk, "utf8");
}

export function createTeamMeetingUserLine(text: string): TeamMeetingLine {
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind: "user",
    text: text.slice(0, TEAM_MEETING_MAX_LINE_TEXT),
  };
}

export function createTeamMeetingAssistantLine(params: {
  text: string;
  assistantId: string;
  displayName: string;
  taskId?: string;
  sessionId?: string;
}): TeamMeetingLine {
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind: "assistant",
    text: params.text.slice(0, TEAM_MEETING_MAX_LINE_TEXT),
    assistantId: params.assistantId,
    displayName: params.displayName,
    ...(params.taskId ? { taskId: params.taskId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
  };
}

export function createTeamMeetingSystemLine(params: {
  text: string;
  delegationId?: string;
}): TeamMeetingLine {
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind: "system",
    text: params.text.slice(0, TEAM_MEETING_MAX_LINE_TEXT),
    ...(params.delegationId ? { delegationId: params.delegationId } : {}),
  };
}

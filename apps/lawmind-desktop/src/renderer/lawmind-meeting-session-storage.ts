/**
 * 会议室：sessionStorage 中的参会会话映射 / 编制缓存（从 MatterTeamMeetingPanel 抽出）。
 */

import type { TeamMeetingLine } from "../../../../src/lawmind/cases/index.ts";

export const MEETING_SESSION_STORAGE_PREFIX = "lawmind.teamMeeting.session.";
export const MEETING_PARTICIPANTS_STORAGE_PREFIX = "lawmind.teamMeeting.participants.";

export function readMeetingSessionMap(matterId: string): Record<string, string | undefined> {
  try {
    const raw = sessionStorage.getItem(`${MEETING_SESSION_STORAGE_PREFIX}${matterId}`);
    if (!raw) {
      return {};
    }
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string | undefined> = {};
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && v.trim()) {
          out[k] = v.trim();
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeMeetingSessionMap(
  matterId: string,
  map: Record<string, string | undefined>,
): void {
  try {
    sessionStorage.setItem(`${MEETING_SESSION_STORAGE_PREFIX}${matterId}`, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

export function readMeetingParticipants(matterId: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(`${MEETING_PARTICIPANTS_STORAGE_PREFIX}${matterId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return null;
  }
}

export function writeMeetingParticipants(matterId: string, ids: string[]): void {
  try {
    sessionStorage.setItem(
      `${MEETING_PARTICIPANTS_STORAGE_PREFIX}${matterId}`,
      JSON.stringify(ids),
    );
  } catch {
    /* ignore quota */
  }
}

export function meetingAuthorLabel(row: TeamMeetingLine): string {
  if (row.kind === "user") {
    return "您";
  }
  if (row.kind === "system") {
    return "主持人";
  }
  return row.displayName?.trim() || row.assistantId || "助手";
}

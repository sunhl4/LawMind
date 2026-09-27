/**
 * 会议室：本机记住的参会会话映射 / 编制缓存。
 * 纪要正文在案件目录；这里只记「下次打开还要接着用」的选择。
 * 用 localStorage，关掉应用还在。旧的 sessionStorage 读到后迁过来。
 */

import type { TeamMeetingLine } from "../../../../src/lawmind/cases/team-meeting-ids.ts";

export const MEETING_SESSION_STORAGE_PREFIX = "lawmind.teamMeeting.session.";
export const MEETING_PARTICIPANTS_STORAGE_PREFIX = "lawmind.teamMeeting.participants.";

function browserStorage(): { local: Storage; session: Storage } | null {
  if (typeof window === "undefined") {
    return null;
  }
  return { local: window.localStorage, session: window.sessionStorage };
}

function readRaw(key: string): string | null {
  const stores = browserStorage();
  if (!stores) {
    return null;
  }
  try {
    const durable = stores.local.getItem(key);
    if (durable) {
      return durable;
    }
    const legacy = stores.session.getItem(key);
    if (legacy) {
      try {
        stores.local.setItem(key, legacy);
      } catch {
        /* quota: keep reading the legacy copy */
      }
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  const stores = browserStorage();
  if (!stores) {
    return;
  }
  try {
    stores.local.setItem(key, value);
  } catch {
    /* ignore quota */
  }
}

export function readMeetingSessionMap(matterId: string): Record<string, string | undefined> {
  try {
    const raw = readRaw(`${MEETING_SESSION_STORAGE_PREFIX}${matterId}`);
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
  writeRaw(`${MEETING_SESSION_STORAGE_PREFIX}${matterId}`, JSON.stringify(map));
}

export function readMeetingParticipants(matterId: string): string[] | null {
  try {
    const raw = readRaw(`${MEETING_PARTICIPANTS_STORAGE_PREFIX}${matterId}`);
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
  writeRaw(`${MEETING_PARTICIPANTS_STORAGE_PREFIX}${matterId}`, JSON.stringify(ids));
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

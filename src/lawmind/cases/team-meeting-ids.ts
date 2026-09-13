/**
 * Browser-safe meeting scope ids and transcript line types (no node:fs / node:crypto).
 * Storage helpers stay in team-meeting.ts (server/engine only).
 */

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

/** Sentinel id kept for API compatibility; storage is under meetings/adhoc/. */
export const ADHOC_MEETING_MATTER_ID = "临时讨论";

export function isAdhocMeetingMatterId(matterId: string | null | undefined): boolean {
  return (matterId?.trim() ?? "") === ADHOC_MEETING_MATTER_ID;
}

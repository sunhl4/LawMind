/**
 * Browser-safe meeting scope ids (no node:fs / node:crypto).
 * Storage helpers stay in team-meeting.ts (server/engine only).
 */

/** Sentinel id kept for API compatibility; storage is under meetings/adhoc/. */
export const ADHOC_MEETING_MATTER_ID = "临时讨论";

export function isAdhocMeetingMatterId(matterId: string | null | undefined): boolean {
  return (matterId?.trim() ?? "") === ADHOC_MEETING_MATTER_ID;
}

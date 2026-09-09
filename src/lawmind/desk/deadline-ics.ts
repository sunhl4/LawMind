/**
 * RFC 5545 ICS export for matter deadlines. Lawyer opens the file in Calendar / Outlook.
 * Does not write Feishu or Graph calendars.
 */

import type { DeadlineRecord } from "../adapters/matter-storage/schemas.js";

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function icsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

export function deadlineIcsUid(deadline: Pick<DeadlineRecord, "deadlineId" | "icsUid">): string {
  return deadline.icsUid?.trim() || `${deadline.deadlineId}@lawmind.local`;
}

export function formatDeadlinesIcs(
  deadlines: DeadlineRecord[],
  opts?: { calendarName?: string },
): string {
  const name = icsEscape(opts?.calendarName?.trim() || "LawMind 期限");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LawMind//Desk//ZH",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${name}`,
  ];
  for (const d of deadlines) {
    const start = icsDate(d.dueAt);
    if (!start) {
      continue;
    }
    const uid = deadlineIcsUid(d);
    const summary = icsEscape(d.title || "期限");
    const desc = icsEscape(d.notes ?? "");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${start}`);
    lines.push(`DTSTART:${start}`);
    lines.push(`SUMMARY:${summary}`);
    if (desc) {
      lines.push(`DESCRIPTION:${desc}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

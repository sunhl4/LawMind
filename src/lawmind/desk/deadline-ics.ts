/**
 * RFC 5545 ICS export for matter deadlines. Lawyer opens the file in Calendar / Outlook.
 * Does not write Feishu or Graph calendars.
 */

import type { DeadlineRecord } from "../adapters/matter-storage/schemas.js";
import { deadlineWaitingOnTitle } from "./deadline-chain.js";
import { defaultRemindBeforeHours } from "./legal-event-extract.js";

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function nextDateOnly(compact: string): string {
  const y = Number(compact.slice(0, 4));
  const m = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}${month}${day}`;
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

/** RFC 5545 folds at 75 octets, not 75 characters. A Chinese summary folded by characters exceeds the limit. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) {
    return line;
  }
  const parts: string[] = [];
  let offset = 0;
  let budget = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + budget, bytes.length);
    while (end > offset && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    if (end === offset) {
      end = Math.min(offset + budget, bytes.length);
    }
    const piece = bytes.subarray(offset, end).toString("utf8");
    parts.push(offset === 0 ? piece : ` ${piece}`);
    offset = end;
    budget = 74;
  }
  return parts.join("\r\n");
}

export function deadlineIcsUid(deadline: Pick<DeadlineRecord, "deadlineId" | "icsUid">): string {
  return deadline.icsUid?.trim() || `${deadline.deadlineId}@lawmind.local`;
}

export function formatDeadlinesIcs(
  deadlines: DeadlineRecord[],
  opts?: { calendarName?: string; exportedAt?: string },
): string {
  const name = icsEscape(opts?.calendarName?.trim() || "LawMind 期限");
  const stamp = icsDate(opts?.exportedAt ?? new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LawMind//Desk//ZH",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${name}`,
  ];
  for (const d of deadlines) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(d.dueAt.trim());
    const start = dateOnly ? d.dueAt.replace(/-/g, "") : icsDate(d.dueAt);
    if (!start) {
      continue;
    }
    const uid = deadlineIcsUid(d);
    const summary = icsEscape(d.title || "期限");
    const waiting = deadlineWaitingOnTitle(d, deadlines);
    const descParts = [d.notes?.trim(), waiting ? `等「${waiting}」完成后列入工作台。` : ""]
      .filter(Boolean)
      .join("\n");
    const desc = icsEscape(descParts);
    const remind = d.remindBeforeHours ?? defaultRemindBeforeHours(d.eventKind ?? "custom");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    if (stamp) {
      lines.push(`DTSTAMP:${stamp}`);
    }
    lines.push(dateOnly ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`);
    if (dateOnly) {
      lines.push(`DTEND;VALUE=DATE:${nextDateOnly(start)}`);
    }
    lines.push(`SUMMARY:${summary}`);
    if (desc) {
      lines.push(`DESCRIPTION:${desc}`);
    }
    if (remind > 0 && !waiting) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`TRIGGER:-PT${remind}H`);
      lines.push(`DESCRIPTION:${summary}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

import fs from "node:fs";
import path from "node:path";
import type { HostLogEvent } from "./types.js";

export function hostAccessLogPath(logDir: string): string {
  return path.join(logDir, "host-access-log.jsonl");
}

export function appendHostAccessLog(
  logDir: string | undefined,
  event: Omit<HostLogEvent, "at">,
): void {
  if (!logDir?.trim()) {
    return;
  }
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const row: HostLogEvent = { ...event, at: new Date().toISOString() };
    fs.appendFileSync(hostAccessLogPath(logDir), `${JSON.stringify(row)}\n`, "utf8");
  } catch {
    /* logging must not break tools */
  }
}

export function readHostAccessLog(logDir: string, limit = 100): HostLogEvent[] {
  const file = hostAccessLogPath(logDir);
  try {
    if (!fs.existsSync(file)) {
      return [];
    }
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const slice = lines.slice(-Math.max(1, limit));
    const out: HostLogEvent[] = [];
    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as HostLogEvent);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

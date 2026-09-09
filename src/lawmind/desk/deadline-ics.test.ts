import { describe, expect, it } from "vitest";
import { formatDeadlinesIcs } from "./deadline-ics.js";

describe("formatDeadlinesIcs", () => {
  it("emits a VEVENT for an open hearing", () => {
    const ics = formatDeadlinesIcs([
      {
        deadlineId: "dl-1",
        matterId: "m1",
        title: "开庭",
        dueAt: "2026-09-15T01:00:00.000Z",
        severity: "hard",
        source: "document_extract",
        status: "open",
        eventKind: "hearing",
      },
    ]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:开庭");
    expect(ics).toContain("UID:dl-1@lawmind.local");
  });
});

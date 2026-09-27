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

  it("keeps gated deadlines in ICS with waiting copy", () => {
    const ics = formatDeadlinesIcs([
      {
        deadlineId: "h1",
        matterId: "m1",
        title: "开庭",
        dueAt: "2026-09-15T01:00:00.000Z",
        severity: "hard",
        source: "document_extract",
        status: "open",
        eventKind: "hearing",
      },
      {
        deadlineId: "a1",
        matterId: "m1",
        title: "上诉期限",
        dueAt: "2026-09-30T01:00:00.000Z",
        severity: "soft",
        source: "document_extract",
        status: "open",
        eventKind: "limitation",
        dependsOnDeadlineId: "h1",
      },
    ]);
    expect(ics).toContain("SUMMARY:上诉期限");
    expect(ics).toContain("等「开庭」完成后列入工作台");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-PT72H");
    const appeal = ics.split("BEGIN:VEVENT")[2] ?? "";
    expect(appeal).toContain("SUMMARY:上诉期限");
    expect(appeal).not.toContain("BEGIN:VALARM");
  });

  it("folds Chinese summaries on UTF-8 octets and keeps a date-only start", () => {
    const title = "开庭".repeat(40);
    const ics = formatDeadlinesIcs(
      [
        {
          deadlineId: "dl-long",
          matterId: "m1",
          title,
          dueAt: "2026-09-30",
          severity: "hard",
          source: "manual",
          status: "open",
          eventKind: "hearing",
          remindBeforeHours: 72,
        },
      ],
      { exportedAt: "2026-09-01T00:00:00.000Z" },
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260930");
    expect(ics).toContain("DTEND;VALUE=DATE:20261001");
    expect(ics).toContain("DTSTAMP:20260901T000000Z");
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });
});

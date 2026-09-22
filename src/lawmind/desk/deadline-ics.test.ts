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
  });
});

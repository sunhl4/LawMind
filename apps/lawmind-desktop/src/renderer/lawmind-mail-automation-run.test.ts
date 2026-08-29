import { describe, expect, it } from "vitest";
import { mailShortPathCreateSchedule } from "./lawmind-mail-automation-run";

describe("mailShortPathCreateSchedule", () => {
  it("creates a once schedule, never interval", () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    expect(mailShortPathCreateSchedule(now)).toEqual({
      kind: "once",
      runAt: "2026-08-13T12:00:00.000Z",
    });
  });
});

import { describe, expect, it } from "vitest";
import { extractLegalEvents } from "./legal-event-extract.js";

describe("extractLegalEvents", () => {
  it("extracts hearing from a summons-like paragraph", () => {
    const events = extractLegalEvents(
      "北京市朝阳区人民法院传票：请于2026年9月15日9时到第三法庭开庭。案号（2026）京0105民初88号。",
    );
    expect(events.some((e) => e.eventKind === "hearing")).toBe(true);
    const hearing = events.find((e) => e.eventKind === "hearing");
    expect(hearing?.dueAt).toMatch(/^2026-09-15/);
  });

  it("extracts court SMS 12368 hearing", () => {
    const events = extractLegalEvents("【12368】请于2026-10-08 09:30到本院参加庭审。");
    expect(events[0]?.eventKind).toBe("hearing");
    expect(events[0]?.dueAt).toBeTruthy();
  });

  it("returns empty for unrelated text", () => {
    expect(extractLegalEvents("今天天气不错")).toEqual([]);
  });
});

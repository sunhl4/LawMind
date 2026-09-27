import { describe, expect, it } from "vitest";
import { lookupOneYearLpr } from "./lpr-quotes.js";

describe("lookupOneYearLpr", () => {
  it("uses the quote in force on the contract date", () => {
    const hit = lookupOneYearLpr("2024-10-21");
    expect(hit.ok).toBe(true);
    if (hit.ok) {
      expect(hit.quote.oneYearPercent).toBe(3.1);
      expect(hit.capPercent).toBe(12.4);
    }
  });

  it("keeps the last published quote through the validity window", () => {
    const hit = lookupOneYearLpr("2026-10-19");
    expect(hit.ok).toBe(true);
    if (hit.ok) {
      expect(hit.quote.oneYearPercent).toBe(3);
      expect(hit.quote.effectiveFrom).toBe("2025-05-20");
    }
  });

  it("refuses to extrapolate past the ingested series", () => {
    const hit = lookupOneYearLpr("2026-10-20");
    expect(hit.ok).toBe(false);
    if (!hit.ok) {
      expect(hit.gap).toContain("不得外推");
    }
  });

  it("does not apply the four-times cap before it took effect", () => {
    const hit = lookupOneYearLpr("2020-04-20");
    expect(hit.ok).toBe(false);
    if (!hit.ok) {
      expect(hit.gap).toContain("尚未施行");
    }
  });
});

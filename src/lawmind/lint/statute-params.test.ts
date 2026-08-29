import { describe, expect, it } from "vitest";
import {
  DEPOSIT_CAP,
  DEFAULT_LIMITATION,
  PRIVATE_LENDING_LPR_MULTIPLE,
  listStatuteParams,
} from "./statute-params.js";

describe("statute-params", () => {
  it("versions every row with source and effectiveFrom", () => {
    const rows = listStatuteParams();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.source.trim().length).toBeGreaterThan(2);
      expect(row.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(DEPOSIT_CAP.value).toBe(0.2);
    expect(DEFAULT_LIMITATION.value).toBe(3);
    expect(PRIVATE_LENDING_LPR_MULTIPLE.value).toBe(4);
  });
});

import { describe, expect, it } from "vitest";
import {
  CONSTRUCTION_WARRANTY_HEATING_PERIODS,
  CONSTRUCTION_WARRANTY_MEP_YEARS,
  CONSTRUCTION_WARRANTY_ROOF_YEARS,
  DEPOSIT_CAP,
  DEFAULT_LIMITATION,
  GUARANTEE_DEFAULT_GENERAL,
  LEASE_TERM_MAX_YEARS,
  NONCOMPETE_MAX_YEARS,
  PRIVATE_LENDING_LPR_MULTIPLE,
  PROBATION_MAX_MONTHS,
  listStatuteDefaults,
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

  it("ships the four high-confidence statutory additions with sources", () => {
    expect(LEASE_TERM_MAX_YEARS).toMatchObject({
      value: 20,
      unit: "years",
      source: "民法典第705条",
    });
    expect(PROBATION_MAX_MONTHS).toMatchObject({
      value: 6,
      unit: "months",
      source: "劳动合同法第19条",
    });
    expect(NONCOMPETE_MAX_YEARS).toMatchObject({
      value: 2,
      unit: "years",
      source: "劳动合同法第24条",
    });
    expect(GUARANTEE_DEFAULT_GENERAL.source).toBe("民法典第686条");
    expect(GUARANTEE_DEFAULT_GENERAL.noteZh).toContain("一般保证");
    expect(listStatuteDefaults().every((r) => r.effectiveFrom.match(/^\d{4}-\d{2}-\d{2}$/))).toBe(
      true,
    );
  });

  it("ships construction warranty floors with source and effectiveFrom", () => {
    expect(CONSTRUCTION_WARRANTY_ROOF_YEARS).toMatchObject({
      value: 5,
      unit: "years",
      source: "建设工程质量管理条例第40条",
    });
    expect(CONSTRUCTION_WARRANTY_MEP_YEARS).toMatchObject({
      value: 2,
      unit: "years",
      source: "建设工程质量管理条例第40条",
    });
    expect(CONSTRUCTION_WARRANTY_HEATING_PERIODS).toMatchObject({
      value: 2,
      unit: "periods",
      source: "建设工程质量管理条例第40条",
    });
    for (const row of [
      CONSTRUCTION_WARRANTY_ROOF_YEARS,
      CONSTRUCTION_WARRANTY_MEP_YEARS,
      CONSTRUCTION_WARRANTY_HEATING_PERIODS,
    ]) {
      expect(row.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

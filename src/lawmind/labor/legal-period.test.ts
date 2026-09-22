import { describe, expect, it } from "vitest";
import { addCalendarDays, addCalendarMonths, computeLegalPeriod } from "./legal-period.js";

describe("legal-period", () => {
  it("adds calendar days across month bounds", () => {
    expect(addCalendarDays("2024-01-31", 15)).toBe("2024-02-15");
    expect(addCalendarMonths("2024-08-31", 6)).toBe("2025-02-28");
  });

  it("computes 15-day appeal and one-year labor arbitration", () => {
    const appeal = computeLegalPeriod("civil_appeal", "2024-01-01");
    expect("expires" in appeal && appeal.expires).toBe("2024-01-16");
    const arb = computeLegalPeriod("labor_arbitration_apply", "2023-03-01");
    expect("expires" in arb && arb.expires).toBe("2024-03-01");
  });
});

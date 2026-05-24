import { describe, expect, it } from "vitest";
import {
  buildGateStatusSummary,
  firstBlockerDomId,
  listBlockingGateDecisions,
} from "./lawmind-gate-display.js";

describe("lawmind-gate-display", () => {
  it("builds summary from blocking gates", () => {
    const summary = buildGateStatusSummary([
      { gate: "acceptance_gate", decision: "block", reason: "缺必备章节" },
    ]);
    expect(summary).toContain("验收门禁");
    expect(summary).toContain("缺必备章节");
  });

  it("firstBlockerDomId points to acceptance region", () => {
    expect(
      firstBlockerDomId([{ gate: "acceptance_gate", decision: "block" }]),
    ).toBe("lm-review-acceptance-gate");
    expect(listBlockingGateDecisions([])).toEqual([]);
  });
});

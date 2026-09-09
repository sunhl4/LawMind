import { describe, expect, it } from "vitest";
import { formatQuickTriageBandLine, inferQuickTriageBand } from "./quick-triage.js";

describe("quick-triage", () => {
  it("answers first, and only holds irreversible public acts", () => {
    expect(inferQuickTriageBand("他一直拖欠工资这算不算违法")).toBe("work");
    expect(inferQuickTriageBand("现在就发微博公开曝光对方")).toBe("hold_irreversible");
    expect(inferQuickTriageBand("这算不算问题")).toBe("answer");
    expect(formatQuickTriageBandLine("现在就发微博公开曝光对方")).toContain("先别做不可逆动作");
    expect(formatQuickTriageBandLine("这算不算问题")).toContain("可先答");
  });
});

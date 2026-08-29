import { describe, expect, it } from "vitest";
import { buildDecisionHeader, resolveDecisionHeader } from "./decision-header.js";

const cleanLint = {
  blockerCount: 0,
  warningCount: 0,
  summaryZh: "机械核对未见已知缺陷。",
};

describe("buildDecisionHeader", () => {
  it("marks usable when low risk and lint is clean", () => {
    const h = buildDecisionHeader({
      title: "保密协议",
      lint: cleanLint,
      riskLevel: "low",
    });
    expect(h.changed).toContain("保密协议");
    expect(h.why).toContain("审阅");
    expect(h.risk).toContain("通过核对 ≠ 法律正确");
    expect(h.ready).toBe("usable");
  });

  it("is honest when lint still has blockers", () => {
    const h = buildDecisionHeader({
      title: "买卖合同",
      lint: { blockerCount: 2, warningCount: 1, summaryZh: "2 项须处理" },
      riskLevel: "low",
    });
    expect(h.ready).toBe("needs_decision");
    expect(h.risk).toContain("2 项须处理");
    expect(h.risk).toContain("通过核对 ≠ 法律正确");
  });

  it("requires a decision for high and medium risk even if lint is clean", () => {
    expect(buildDecisionHeader({ title: "起诉状", lint: cleanLint, riskLevel: "high" }).ready).toBe(
      "needs_decision",
    );
    expect(
      buildDecisionHeader({ title: "备忘录", lint: cleanLint, riskLevel: "medium" }).ready,
    ).toBe("needs_decision");
    expect(
      buildDecisionHeader({ title: "起诉状", lint: cleanLint, riskLevel: "high" }).risk,
    ).toContain("高风险");
  });

  it("mentions self-revise fixes and residual subjective items", () => {
    const h = buildDecisionHeader({
      title: "劳动合同",
      lint: cleanLint,
      riskLevel: "low",
      selfRevise: {
        rounds: 2,
        appliedCount: 3,
        appliedSummaries: ["补全占位", "统一主体称谓"],
        residualCount: 1,
        residualSummaries: ["违约金是否过高"],
      },
    });
    expect(h.changed).toContain("补全占位");
    expect(h.why).toContain("主观裁量");
    expect(h.ready).toBe("needs_decision");
  });

  it("uses appliedCount when summaries are empty", () => {
    const h = buildDecisionHeader({
      title: "通知函",
      lint: cleanLint,
      riskLevel: "low",
      selfRevise: { appliedCount: 2, rounds: 1, residualCount: 0 },
    });
    expect(h.changed).toContain("2 处");
    expect(h.ready).toBe("usable");
  });
});

describe("resolveDecisionHeader", () => {
  it("prefers a persisted header when complete", () => {
    const persisted = {
      changed: "只改了送达地址",
      why: "与原合同对齐",
      risk: "低",
      ready: "usable" as const,
    };
    const h = resolveDecisionHeader({
      persisted,
      title: "忽略",
      lint: { blockerCount: 4, warningCount: 0, summaryZh: "x" },
    });
    expect(h).toEqual(persisted);
  });

  it("falls back to the builder when persisted is incomplete", () => {
    const h = resolveDecisionHeader({
      persisted: { changed: "x" },
      title: "顾问合同",
      lint: { blockerCount: 1, warningCount: 0, summaryZh: "x" },
    });
    expect(h.ready).toBe("needs_decision");
    expect(h.changed).toContain("顾问合同");
  });
});

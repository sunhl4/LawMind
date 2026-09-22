import { describe, expect, it } from "vitest";
import { buildDeliberationPlan, formatDeliberationStatus } from "./lawmind-meeting-deliberation";

describe("buildDeliberationPlan", () => {
  const participants = [
    { assistantId: "a", displayName: "甲助手" },
    { assistantId: "b", displayName: "乙助手" },
  ];

  it("builds chair rounds then conclude without lawyer opening", () => {
    const plan = buildDeliberationPlan({
      participants,
      topic: "和解空间",
      rounds: 2,
    });
    expect(plan).toHaveLength(5); // 2*2 chair + conclude
    expect(plan[0]?.meetingTurnKind).toBe("chair");
    expect(plan[0]?.assistantId).toBe("a");
    expect(plan[1]?.assistantId).toBe("b");
    expect(plan[4]?.meetingTurnKind).toBe("conclude");
    expect(plan[4]?.assistantId).toBe("b");
    expect(plan.every((c) => c.turnsTotal === 5)).toBe(true);
  });

  it("prepends lawyer opening when provided", () => {
    const plan = buildDeliberationPlan({
      participants,
      topic: "管辖",
      rounds: 1,
      lawyerOpening: "请先谈管辖风险",
    });
    expect(plan[0]?.meetingTurnKind).toBe("lawyer");
    expect(plan[0]?.message).toContain("管辖风险");
    expect(plan).toHaveLength(4); // lawyer + 2 chair + conclude
  });

  it("uses synthesizerId when valid", () => {
    const plan = buildDeliberationPlan({
      participants,
      topic: "证据",
      rounds: 1,
      synthesizerId: "a",
    });
    expect(plan.at(-1)?.assistantId).toBe("a");
  });

  it("returns empty when topic or participants missing", () => {
    expect(buildDeliberationPlan({ participants, topic: "  ", rounds: 1 })).toEqual([]);
    expect(buildDeliberationPlan({ participants: [], topic: "x", rounds: 1 })).toEqual([]);
  });
});

describe("formatDeliberationStatus", () => {
  it("labels conclude and chair turns", () => {
    expect(
      formatDeliberationStatus({
        assistantId: "a",
        displayName: "甲",
        meetingTurnKind: "conclude",
        message: "x",
        round: 2,
        roundsTotal: 2,
        turnIndex: 5,
        turnsTotal: 5,
      }),
    ).toContain("汇总结论");
    expect(
      formatDeliberationStatus({
        assistantId: "a",
        displayName: "甲",
        meetingTurnKind: "chair",
        message: "x",
        round: 1,
        roundsTotal: 2,
        turnIndex: 1,
        turnsTotal: 5,
      }),
    ).toContain("甲 发言中");
  });
});

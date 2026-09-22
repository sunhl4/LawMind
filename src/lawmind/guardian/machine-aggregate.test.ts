import { describe, expect, it } from "vitest";
import { aggregateGuardianItems, aggregateMachineOnly } from "./legal-guardian.js";
import type { GuardianMachineVerdict } from "./legal-guardian.js";

function mv(
  itemId: string,
  supported: boolean,
  status: "ok" | "unavailable" = "ok",
): GuardianMachineVerdict {
  return { itemId, supported, status, reason: `${itemId} 的自动核对结论` };
}

describe("G0 聚合：on 模式下 machine 结论参与 verdict", () => {
  it("machine 未覆盖 → 产生 machine_not_covered 并 fail", () => {
    const agg = aggregateGuardianItems({
      items: [],
      summaryGaps: [],
      expectedItemIds: [],
      machineVerdicts: [mv("pr.deposit", false)],
      machineAffectsOutcome: true,
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.gaps.map((g) => g.code)).toContain("machine_not_covered");
  });

  it("machine 验证器不可用 → 产生 machine_unavailable 并 fail（**绝不当作通过**）", () => {
    const agg = aggregateGuardianItems({
      items: [],
      summaryGaps: [],
      expectedItemIds: [],
      machineVerdicts: [mv("loan.rate", false, "unavailable")],
      machineAffectsOutcome: true,
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.gaps.map((g) => g.code)).toContain("machine_unavailable");
  });

  it("machine 全部通过且无 summaryGaps → pass", () => {
    const agg = aggregateGuardianItems({
      items: [],
      summaryGaps: [],
      expectedItemIds: [],
      machineVerdicts: [mv("pr.deposit", true), mv("loan.rate", true)],
      machineAffectsOutcome: true,
    });
    expect(agg.verdict).toBe("pass");
    expect(agg.gaps).toHaveLength(0);
  });

  it("同一项被判定多次 → machine_duplicate_verdict（结论不可信）", () => {
    const agg = aggregateGuardianItems({
      items: [],
      summaryGaps: [],
      expectedItemIds: [],
      machineVerdicts: [mv("pr.deposit", true), mv("pr.deposit", false)],
      machineAffectsOutcome: true,
    });
    expect(agg.gaps.map((g) => g.code)).toContain("machine_duplicate_verdict");
  });
});

describe("G0 聚合：shadow 期只记录、不改 verdict（默认零风险的技术依据）", () => {
  it("machine 未覆盖但 affectsOutcome=false → **不产生缺口**，verdict 不受影响", () => {
    const agg = aggregateGuardianItems({
      items: [],
      summaryGaps: [],
      expectedItemIds: [],
      machineVerdicts: [mv("pr.deposit", false)],
      machineAffectsOutcome: false,
    });
    expect(agg.verdict).toBe("pass");
    expect(agg.gaps).toHaveLength(0);
    // 但结论被记录下来了——这正是转 `on` 的依据。
    expect(agg.machineVerdicts.map((v) => v.itemId)).toEqual(["pr.deposit"]);
  });

  it("shadow：machine 与 model 结论相反 → 记入 tierConflicts，但不改 verdict", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "pr.deposit", supported: true }],
      summaryGaps: [],
      expectedItemIds: ["pr.deposit"],
      machineVerdicts: [mv("pr.deposit", false)],
      machineAffectsOutcome: false,
    });
    expect(agg.tierConflicts).toEqual(["pr.deposit"]);
    expect(agg.verdict).toBe("pass");
    expect(agg.gaps).toHaveLength(0);
  });

  it("一致时不记冲突", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "pr.deposit", supported: false }],
      summaryGaps: [],
      expectedItemIds: ["pr.deposit"],
      machineVerdicts: [mv("pr.deposit", false)],
      machineAffectsOutcome: false,
    });
    expect(agg.tierConflicts).toEqual([]);
  });

  it("不可用的验证器不参与冲突统计（它不是「结论相反」，是没有结论）", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "pr.deposit", supported: true }],
      summaryGaps: [],
      expectedItemIds: ["pr.deposit"],
      machineVerdicts: [mv("pr.deposit", false, "unavailable")],
      machineAffectsOutcome: false,
    });
    expect(agg.tierConflicts).toEqual([]);
  });
});

describe("G0 聚合：lawyer 项不参与 verdict", () => {
  it("lawyer 项不放进 expectedItemIds → 不产生「未回答」缺口", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "pr.pay", supported: true }],
      summaryGaps: [],
      // 注意：不含 pr.cap（主观项）——它不进提示词，也不该被要求回答。
      expectedItemIds: ["pr.pay"],
      machineVerdicts: [],
      machineAffectsOutcome: true,
    });
    expect(agg.verdict).toBe("pass");
  });

  it("没有 judge 项时 aggregateMachineOnly 仍能给出结论", () => {
    const agg = aggregateMachineOnly({
      machineVerdicts: [mv("pr.deposit", true)],
      affectsOutcome: true,
    });
    expect(agg.verdict).toBe("pass");
    expect(agg.itemVerdicts).toEqual([]);
  });
});

describe("G0 聚合：向后兼容（不传 machine 时行为与改造前一致）", () => {
  it("既有口径不变：未回答判 fail", () => {
    const agg = aggregateGuardianItems({
      items: [],
      summaryGaps: [],
      expectedItemIds: ["c1"],
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.gaps.map((g) => g.code)).toEqual(["checklist_unanswered"]);
    expect(agg.machineVerdicts).toEqual([]);
    expect(agg.tierConflicts).toEqual([]);
  });

  it("既有口径不变：编造项 id 判 fail", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "made-up", supported: true }],
      summaryGaps: [],
      expectedItemIds: ["c1"],
    });
    expect(agg.unknownItemIds).toEqual(["made-up"]);
    expect(agg.gaps.map((g) => g.code)).toContain("checklist_unknown_item");
  });
});

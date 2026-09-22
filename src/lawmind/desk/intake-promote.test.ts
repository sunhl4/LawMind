import { describe, expect, it } from "vitest";
import type { IntakeBrief } from "./intake-brief.js";
import { extractPartyCandidates, planIntakePromotion } from "./intake-promote.js";

function brief(over: Partial<IntakeBrief> = {}): IntakeBrief {
  return {
    matterId: "m1",
    clientNeeds: [],
    coreFacts: [],
    issues: [],
    causeCandidates: [],
    evidenceGaps: [],
    nextActions: [],
    source: "talk",
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("extractPartyCandidates", () => {
  it("reads labelled parties from a talk transcript", () => {
    const found = extractPartyCandidates(
      "委托人：张北县瑞霖乳制品有限公司。对方：某乳业集团。原告：张三（已另案）。",
    );
    expect(found).toEqual([
      { name: "张北县瑞霖乳制品有限公司", label: "委托人" },
      { name: "某乳业集团", label: "对方" },
      { name: "张三", label: "原告" },
    ]);
  });

  it("ignores unlabelled names and prose", () => {
    expect(extractPartyCandidates("客户上周来过，说要起诉。")).toEqual([]);
  });
});

describe("planIntakePromotion", () => {
  it("promotes a lexicon-backed cause only when the docket has none", () => {
    const withCause = planIntakePromotion({
      current: { causeOfAction: "房屋租赁合同纠纷" },
      brief: brief({ causeCandidates: [{ label: "买卖合同纠纷", reason: "材料关键词" }] }),
    });
    expect(withCause.causeOfAction).toBeUndefined();
    expect(withCause.promoted).not.toContain("案由");

    const empty = planIntakePromotion({
      current: {},
      brief: brief({ causeCandidates: [{ label: "买卖合同纠纷", reason: "材料关键词" }] }),
    });
    expect(empty.causeOfAction).toBe("买卖合同纠纷");
    expect(empty.promoted).toContain("案由");
  });

  it("locates 委托人/对方 but only registers 原告/被告 without guessing our side", () => {
    const plan = planIntakePromotion({
      current: {},
      brief: brief(),
      partyCandidates: [
        { name: "瑞霖公司", label: "委托人" },
        { name: "某乳业集团", label: "对方" },
        { name: "张三", label: "原告" },
        { name: "李四", label: "被告" },
      ],
    });
    const byName = new Map(plan.parties?.map((p) => [p.name, p]));
    expect(byName.get("瑞霖公司")?.role).toBe("client");
    expect(byName.get("某乳业集团")?.role).toBe("counterparty");
    // 立场判断交给律师/模型，不猜；但当事人和地位不丢。
    expect(byName.get("张三")?.role).toBe("other");
    expect(byName.get("张三")?.standing).toBe("原告");
    expect(byName.get("李四")?.standing).toBe("被告");
    expect(plan.standingOnly).toEqual(["原告：张三", "被告：李四"]);
    expect(plan.promoted).toContain("当事人");
  });

  it("never clobbers parties the lawyer already entered", () => {
    const plan = planIntakePromotion({
      current: {
        parties: [{ partyId: "p-client", name: "张三", role: "client" }],
      },
      brief: brief(),
      partyCandidates: [
        { name: "张三", label: "委托人" },
        { name: "某乳业集团", label: "对方" },
      ],
    });
    expect(plan.parties).toHaveLength(2);
    expect(plan.parties?.filter((p) => p.name === "张三")).toHaveLength(1);
    // 既有当事人的角色不被改写。
    expect(plan.parties?.find((p) => p.name === "张三")?.role).toBe("client");
  });
});

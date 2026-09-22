import { describe, expect, it } from "vitest";
import {
  buildTierIndex,
  lawyerOnlyKeys,
  machineItemsByVerifier,
  resolveJudgmentTier,
  verificationKey,
  wordRevisionKey,
  type JudgmentTable,
} from "./judgment-tier.js";

const TABLE: JudgmentTable = {
  "pr.pay": { tier: "judge", rationale: "需读条款实质" },
  "pr.deposit": { tier: "machine", verifier: "statute.deposit_cap", rationale: "法定上限比较" },
  "pr.cap": { tier: "lawyer", lawyerReason: "商业风险分配", rationale: "无数值正解" },
  [verificationKey("general-v1", "citations")]: {
    tier: "machine",
    verifier: "citations.subset",
    rationale: "集合包含判断",
  },
};

describe("G0 resolveJudgmentTier：三条 fail-closed 纪律", () => {
  it("已分级的项原样返回", () => {
    const r = resolveJudgmentTier({ key: "pr.pay", table: TABLE, knownItem: true });
    expect(r.judgment.tier).toBe("judge");
    expect(r.warnings).toEqual([]);
  });

  it("未声明的项落 judge（宁可多问模型，不可少判）并记 warning", () => {
    const r = resolveJudgmentTier({ key: "pr.new_item", table: TABLE, knownItem: true });
    expect(r.judgment.tier).toBe("judge");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/judge/);
  });

  it("不在任何清单里的键也落 judge，但 warning 提示该清理判定表", () => {
    const r = resolveJudgmentTier({ key: "pr.gone", table: TABLE, knownItem: false });
    expect(r.judgment.tier).toBe("judge");
    expect(r.warnings[0]).toMatch(/不在任何清单/);
  });

  it("声明 machine 但缺 verifier → 降回 judge 并记 warning（不得静默跳过）", () => {
    const table: JudgmentTable = {
      "pr.bad": { tier: "machine", rationale: "忘了写验证器" },
    };
    const r = resolveJudgmentTier({ key: "pr.bad", table, knownItem: true });
    expect(r.judgment.tier).toBe("judge");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/降回 judge/);
  });

  it("声明 lawyer 但缺 lawyerReason → **保留 lawyer**（不判比误判安全），只记 warning", () => {
    const table: JudgmentTable = {
      "pr.tone": { tier: "lawyer", rationale: "策略判断" },
    };
    const r = resolveJudgmentTier({ key: "pr.tone", table, knownItem: true });
    expect(r.judgment.tier).toBe("lawyer");
    expect(r.warnings[0]).toMatch(/lawyerReason/);
  });

  it("键无重复语义：同名条项跨 spec 必须带 specId 前缀", () => {
    expect(verificationKey("contract-review-v1", "citations")).toBe("contract-review-v1/citations");
    expect(verificationKey("general-v1", "citations")).not.toBe(
      verificationKey("contract-review-v1", "citations"),
    );
    expect(wordRevisionKey("pr.pay")).toBe("pr.pay");
  });
});

describe("G0 判定表派生视图", () => {
  it("buildTierIndex 给出键 → 判定主体", () => {
    const idx = buildTierIndex(TABLE);
    expect(idx.get("pr.deposit")).toBe("machine");
    expect(idx.get("pr.cap")).toBe("lawyer");
  });

  it("lawyerOnlyKeys 恰好是主观项集合", () => {
    expect([...lawyerOnlyKeys(TABLE)]).toEqual(["pr.cap"]);
  });

  it("machineItemsByVerifier 按验证器归拢", () => {
    const byVerifier = machineItemsByVerifier(TABLE);
    expect(byVerifier.get("statute.deposit_cap")).toEqual(["pr.deposit"]);
    expect(byVerifier.get("citations.subset")).toEqual(["general-v1/citations"]);
  });
});

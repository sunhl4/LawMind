import { describe, expect, it } from "vitest";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import {
  collectContextTuningKeys,
  CONTEXT_RATIO_MIN,
  DEFAULT_CONTEXT_TUNING,
  resolveContextPolicy,
  resolveContextTuning,
  TOKEN_BUDGET_WARN_RATIO,
} from "./context-tuning.js";

function policyWith(context: unknown): LawMindWorkspacePolicy {
  return { schemaVersion: 1, context: context as LawMindWorkspacePolicy["context"] };
}

describe("resolveContextTuning — 默认值与行为不变", () => {
  it("没有 policy / 没有 context 时逐位等于默认（接入 policy 前的行为）", () => {
    expect(resolveContextTuning(null)).toEqual(DEFAULT_CONTEXT_TUNING);
    expect(resolveContextTuning(undefined)).toEqual(DEFAULT_CONTEXT_TUNING);
    expect(resolveContextTuning({ schemaVersion: 1 })).toEqual(DEFAULT_CONTEXT_TUNING);
  });

  it("导出仍是旧名字，方便老调用方", () => {
    expect(TOKEN_BUDGET_WARN_RATIO).toBe(DEFAULT_CONTEXT_TUNING.budget.warnRatio);
    expect(resolveContextPolicy(null)).toEqual(DEFAULT_CONTEXT_TUNING.budget);
  });

  it("返回值是冻结的：调用方改不动共享默认表", () => {
    const tuning = resolveContextTuning(null);
    expect(Object.isFrozen(tuning)).toBe(true);
    expect(Object.isFrozen(tuning.budget)).toBe(true);
    // 非严格模式下静默失败，严格模式抛错；两种都不得真的改掉默认值。
    try {
      (tuning.budget as { warnRatio: number }).warnRatio = 0.1;
    } catch {
      /* expected in strict mode */
    }
    expect(resolveContextTuning(null).budget.warnRatio).toBe(
      DEFAULT_CONTEXT_TUNING.budget.warnRatio,
    );
  });
});

describe("resolveContextTuning — 类型不对回落默认（绝不抛错）", () => {
  it("字符串 / null / 数组 / NaN 一律回落", () => {
    const tuning = resolveContextTuning(
      policyWith({
        warnRatio: "0.5",
        midTurnCompactTriggerRatio: null,
        smallWindowReserveRatio: [],
        contextTokens: Number.NaN,
        midTurn: { maxPerTurn: "3" },
        digest: { charRatio: "0.2" },
        pins: { factEnabled: "yes" },
        carryover: { seedCharRatio: Infinity },
      }),
    );
    expect(tuning.budget.warnRatio).toBe(DEFAULT_CONTEXT_TUNING.budget.warnRatio);
    expect(tuning.budget.midTurnCompactTriggerRatio).toBe(
      DEFAULT_CONTEXT_TUNING.budget.midTurnCompactTriggerRatio,
    );
    expect(tuning.budget.smallWindowReserveRatio).toBe(
      DEFAULT_CONTEXT_TUNING.budget.smallWindowReserveRatio,
    );
    expect(tuning.budget.contextTokens).toBe(DEFAULT_CONTEXT_TUNING.budget.contextTokens);
    expect(tuning.midTurn.maxPerTurn).toBe(DEFAULT_CONTEXT_TUNING.midTurn.maxPerTurn);
    expect(tuning.digest.charRatio).toBe(DEFAULT_CONTEXT_TUNING.digest.charRatio);
    expect(tuning.pins.factEnabled).toBe(DEFAULT_CONTEXT_TUNING.pins.factEnabled);
    expect(tuning.carryover.seedCharRatio).toBe(DEFAULT_CONTEXT_TUNING.carryover.seedCharRatio);
  });

  it("分组写成非对象（字符串）时整组回落，而不是炸", () => {
    const tuning = resolveContextTuning(
      policyWith({ midTurn: "fast", digest: 42, pins: false, carryover: null }),
    );
    expect(tuning.midTurn).toEqual(DEFAULT_CONTEXT_TUNING.midTurn);
    expect(tuning.digest).toEqual(DEFAULT_CONTEXT_TUNING.digest);
    expect(tuning.pins).toEqual(DEFAULT_CONTEXT_TUNING.pins);
    expect(tuning.carryover).toEqual(DEFAULT_CONTEXT_TUNING.carryover);
  });

  it("context 本身写成字符串时整段回落", () => {
    expect(resolveContextTuning(policyWith("nonsense"))).toEqual(DEFAULT_CONTEXT_TUNING);
  });
});

describe("resolveContextTuning — 越界夹取", () => {
  it("比例夹到 (0, 1]，负数与超大值都收敛", () => {
    const tuning = resolveContextTuning(
      policyWith({
        warnRatio: 5,
        midTurnCompactTriggerRatio: -3,
        smallWindowReserveRatio: 99,
        midTurn: { elideThresholdRatio: 2 },
        digest: { charRatio: -1, llmSummaryShare: 100 },
        carryover: { seedCharRatio: 9, digestShare: 0 },
      }),
    );
    // 非正的「比例」是明显非法值，收敛到下界；下界只要求「正且极小」。
    expect(tuning.budget.midTurnCompactTriggerRatio).toBe(CONTEXT_RATIO_MIN);
    expect(tuning.budget.smallWindowReserveRatio).toBe(0.9);
    expect(tuning.midTurn.elideThresholdRatio).toBe(1);
    expect(tuning.digest.charRatio).toBe(CONTEXT_RATIO_MIN);
    expect(tuning.digest.llmSummaryShare).toBe(0.9);
    expect(tuning.carryover.seedCharRatio).toBe(0.5);
    // 语义上「占比不得为 0」的两项另有业务下界，不跟着比例下界走。
    expect(tuning.carryover.digestShare).toBe(0.05);
  });

  it("合法的小比例不被静默改写（0.02 触发线必须原样生效）", () => {
    // 回归：曾把下界写成 0.1，于是「把触发线压到 0.02 以强制触发」被静默改成 0.1。
    const tuning = resolveContextTuning(
      policyWith({
        midTurnCompactTriggerRatio: 0.02,
        warnRatio: 0.01,
        midTurn: { elideThresholdRatio: 0.02 },
        digest: { charRatio: 0.02, llmSummaryShare: 0.02 },
      }),
    );
    expect(tuning.budget.midTurnCompactTriggerRatio).toBe(0.02);
    expect(tuning.budget.warnRatio).toBe(0.01);
    expect(tuning.midTurn.elideThresholdRatio).toBe(0.02);
    expect(tuning.digest.charRatio).toBe(0.02);
    expect(tuning.digest.llmSummaryShare).toBe(0.02);
  });

  it("整数按边界夹取且取整", () => {
    const tuning = resolveContextTuning(
      policyWith({
        contextTokens: 10,
        summaryOutputTokenReserve: -5,
        midTurn: { maxPerTurn: 999, elideKeepTail: 3.7, llmDigestTimeoutMs: 1 },
        digest: {
          recentLineKeep: 0,
          citationAnchorMax: 10_000,
          taskLineMax: 0,
          carriedMinChars: 1,
        },
        pins: { factMaxItems: -1, factItemCharCap: 999_999 },
        carryover: { digestPreviewChars: 1, suggestMinCompacts: 0, digestMinChars: 0 },
      }),
    );
    expect(tuning.budget.contextTokens).toBe(1_000);
    expect(tuning.budget.summaryOutputTokenReserve).toBe(0);
    expect(tuning.midTurn.maxPerTurn).toBe(20);
    expect(tuning.midTurn.elideKeepTail).toBe(4);
    expect(tuning.midTurn.llmDigestTimeoutMs).toBe(500);
    expect(tuning.digest.recentLineKeep).toBe(1);
    expect(tuning.digest.citationAnchorMax).toBe(200);
    expect(tuning.digest.taskLineMax).toBe(1);
    expect(tuning.digest.carriedMinChars).toBe(100);
    expect(tuning.pins.factMaxItems).toBe(0);
    expect(tuning.pins.factItemCharCap).toBe(2_000);
    expect(tuning.carryover.digestPreviewChars).toBe(50);
    expect(tuning.carryover.digestMinChars).toBe(100);
    expect(tuning.carryover.suggestMinCompacts).toBe(1);
  });
});

describe("resolveContextTuning — 跨字段不变量", () => {
  it("注记线不得晚于压缩线（否则注记永远看不到）", () => {
    const tuning = resolveContextTuning(
      policyWith({ warnRatio: 0.99, midTurnCompactTriggerRatio: 0.5 }),
    );
    expect(tuning.budget.midTurnCompactTriggerRatio).toBe(0.5);
    expect(tuning.budget.warnRatio).toBe(0.5);
  });

  it("min > max 时 min 被夹到 max，不产出非法区间", () => {
    const tuning = resolveContextTuning(
      policyWith({
        digest: { minChars: 20_000, maxChars: 1_000 },
        carryover: { seedMinChars: 50_000, seedMaxChars: 20_000 },
      }),
    );
    expect(tuning.digest.minChars).toBeLessThanOrEqual(tuning.digest.maxChars);
    expect(tuning.carryover.seedMinChars).toBeLessThanOrEqual(tuning.carryover.seedMaxChars);
  });
});

describe("resolveContextTuning — 显式值真的生效", () => {
  it("按部署把压缩调早、帽调小", () => {
    const tuning = resolveContextTuning(
      policyWith({
        midTurnCompactTriggerRatio: 0.7,
        warnRatio: 0.6,
        contextTokens: 32_768,
        midTurn: { maxPerTurn: 5, llmDigestTimeoutMs: 4_000, deferralBounceMax: 1 },
        digest: { charRatio: 0.1, maxChars: 10_000 },
        pins: { factMaxItems: 6, factTotalCharCap: 800 },
        carryover: { seedCharRatio: 0.05, suggestMinCompacts: 3 },
      }),
    );
    expect(tuning.budget.midTurnCompactTriggerRatio).toBe(0.7);
    expect(tuning.budget.warnRatio).toBe(0.6);
    expect(tuning.budget.contextTokens).toBe(32_768);
    expect(tuning.midTurn.maxPerTurn).toBe(5);
    expect(tuning.midTurn.llmDigestTimeoutMs).toBe(4_000);
    expect(tuning.midTurn.deferralBounceMax).toBe(1);
    expect(tuning.digest.charRatio).toBe(0.1);
    expect(tuning.digest.maxChars).toBe(10_000);
    expect(tuning.pins.factMaxItems).toBe(6);
    expect(tuning.pins.factTotalCharCap).toBe(800);
    expect(tuning.carryover.seedCharRatio).toBe(0.05);
    expect(tuning.carryover.suggestMinCompacts).toBe(3);
  });

  it("布尔开关生效", () => {
    const off = resolveContextTuning(policyWith({ digest: { llmDigestEnabled: false } }));
    expect(off.digest.llmDigestEnabled).toBe(false);
    const pinOff = resolveContextTuning(policyWith({ pins: { factEnabled: false } }));
    expect(pinOff.pins.factEnabled).toBe(false);
  });
});

describe("collectContextTuningKeys", () => {
  it("列出显式写过的键（含拼错的），供体检页核对", () => {
    const keys = collectContextTuningKeys(
      policyWith({
        warnRatio: 0.8,
        midTurn: { maxPerTurn: 2, typoKey: 1 },
        carryover: { suggestMinCompacts: 3 },
      }),
    );
    expect(keys).toContain("context.warnRatio");
    expect(keys).toContain("context.midTurn.maxPerTurn");
    expect(keys).toContain("context.midTurn.typoKey");
    expect(keys).toContain("context.carryover.suggestMinCompacts");
  });

  it("没有 context 时返回空", () => {
    expect(collectContextTuningKeys(null)).toEqual([]);
    expect(collectContextTuningKeys({ schemaVersion: 1 })).toEqual([]);
  });
});

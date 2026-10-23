import { describe, expect, it } from "vitest";
import type { AgentModelConfig } from "../agent/types.js";
import { CN_SALES_RULES } from "../review/playbooks/cn-sales.js";
import { filterRulesForPaper } from "../review/rules.js";
import { synthesizeAnswers } from "../review/verdict-oracle.js";
import {
  buildRuleGoal,
  isInfrastructureError,
  runRuleAllPassModelArm,
} from "./rule-allpass-model-arm.js";
import { loadRuleAllPassFixtures, oracleClassifications } from "./rule-allpass.js";

const model: AgentModelConfig = {
  provider: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
};

const loaded = loadRuleAllPassFixtures();
const firstCase = loaded.cases[0];

/** Answers every criterion correctly, like a perfect reader would. */
function perfectClassifier() {
  return async ({ rule }: { rule: { ruleId: string } }) => {
    const kind = firstCase.expected[rule.ruleId];
    if (!kind) {
      return { error: `no expectation for ${rule.ruleId}` };
    }
    return { answers: synthesizeAnswers(rule as never, kind) };
  };
}

describe("buildRuleGoal", () => {
  it("asks the rule's own criteria by id and carries the standard", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "dispute.forum.counterparty")!;
    const goal = buildRuleGoal(rule);
    expect(goal).toContain(rule.ruleId);
    expect(goal).toContain(rule.standard);
    for (const criterion of rule.criteria) {
      expect(goal).toContain(criterion.question);
      expect(goal).toContain(`[${criterion.id}]`);
    }
    expect(goal).toContain("只交回本规则的逐题答案");
  });

  it("never asks the model to pick a tier", () => {
    // The whole point of the redesign: the model must not choose compliant /
    // acceptable / unacceptable. Guard the prompt against regressing.
    for (const rule of CN_SALES_RULES) {
      const goal = buildRuleGoal(rule);
      expect(goal).not.toContain("判 compliant");
      expect(goal).not.toContain("判 unacceptable");
      expect(goal).not.toContain("判 acceptable_deviation");
      expect(goal).toContain("档位由引擎");
    }
  });

  it("tells the worker what an absent clause means for this rule", () => {
    const forbids = CN_SALES_RULES.find((r) => r.ruleId === "liability.cap.counterparty")!;
    expect(forbids.absentAllowed).toBe(false);
    expect(buildRuleGoal(forbids)).toContain("clausePresent 填 false；本规则不允许缺失");

    const allows = CN_SALES_RULES.find((r) => r.ruleId === "termination.symmetry.counterparty")!;
    expect(allows.absentAllowed).toBe(true);
    expect(buildRuleGoal(allows)).toContain("clausePresent 填 false（不要逐题作答）");
  });

  it("keeps unknown reserved, not a blanket safe answer", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "liability.cap.counterparty")!;
    const goal = buildRuleGoal(rule);
    expect(goal).toContain("unknown 仅用于");
    expect(goal).toContain("不要为了保守而滥答 unknown");
  });
});

describe("runRuleAllPassModelArm", () => {
  it("scores a perfect classifier as all-pass and makes one call per rule", async () => {
    let calls = 0;
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      concurrency: 3,
      classifyRule: async (input) => {
        calls += 1;
        return perfectClassifier()(input);
      },
    });
    expect(calls).toBe(filterRulesForPaper(CN_SALES_RULES, firstCase.paper).length);
    expect(result.totalCalls).toBe(calls);
    expect(result.failures).toEqual([]);
    expect(result.stoppedEarly).toBe(false);
    expect(result.cases[0]?.score.pass).toBe(true);
    expect(result.arm).toBe("model:deepseek-chat");
  });

  it("records a wrong verdict as a mismatch, not as a pass", async () => {
    const target = "liability.cap.counterparty";
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      classifyRule: async ({ rule }) => {
        const expected = firstCase.expected[rule.ruleId];
        const kind = rule.ruleId === target ? "unacceptable" : expected;
        return { answers: synthesizeAnswers(rule as never, kind as never) };
      },
    });
    expect(result.cases[0]?.score.pass).toBe(false);
    expect(result.cases[0]?.score.mismatches[0]?.ruleId).toBe(target);
    expect(result.failures).toEqual([]);
  });

  it("treats a missing verdict as a failure and reports it", async () => {
    const skipped = "payment.acceptance.counterparty";
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      classifyRule: async ({ rule }) => {
        if (rule.ruleId === skipped) {
          return { error: "worker returned no verdictAnswers" };
        }
        return perfectClassifier()({ rule });
      },
    });
    expect(result.cases[0]?.score.pass).toBe(false);
    expect(result.cases[0]?.score.missing).toEqual([skipped]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.ruleId).toBe(skipped);
  });

  it("stops the arm on an auth error instead of burning the whole budget", async () => {
    const result = await runRuleAllPassModelArm({
      cases: loaded.cases,
      chatModel: model,
      concurrency: 1,
      classifyRule: async () => ({ error: "401 Unauthorized" }),
    });
    expect(result.stoppedEarly).toBe(true);
    expect(result.cases).toHaveLength(1);
    expect(result.totalCalls).toBeLessThanOrEqual(
      filterRulesForPaper(CN_SALES_RULES, firstCase.paper).length,
    );
  });

  it("times out a hung rule without stalling the arm", async () => {
    const hung = "ip.data.counterparty";
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      timeoutMs: 20,
      classifyRule: async ({ rule }) => {
        if (rule.ruleId === hung) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return perfectClassifier()({ rule });
      },
    });
    expect(result.cases[0]?.score.missing).toEqual([hung]);
    expect(result.failures[0]?.error).toMatch(/timed out/);
  });

  it("respects maxCases as a budget guard", async () => {
    const result = await runRuleAllPassModelArm({
      cases: loaded.cases,
      chatModel: model,
      maxCases: 2,
      classifyRule: perfectClassifier(),
    });
    expect(result.cases).toHaveLength(2);
  });

  it("matches the oracle on the in-repo fixtures when the classifier is perfect", async () => {
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      classifyRule: async ({ rule }) => {
        const expected = firstCase.expected[rule.ruleId];
        if (!expected) {
          return { error: "missing" };
        }
        return { answers: synthesizeAnswers(rule as never, expected as never) };
      },
    });
    expect(result.cases[0]?.score.pass).toBe(true);
    // The oracle helper and the arm must agree about every rule.
    const oracleKinds = new Map(oracleClassifications(firstCase).map((c) => [c.ruleId, c.kind]));
    for (const perRule of result.cases[0].perRule) {
      expect(perRule.kind).toBe(oracleKinds.get(perRule.ruleId));
    }
  });
});

describe("trials and stability", () => {
  it("takes the majority verdict across samples", async () => {
    // Per-rule counter: the third sample of each rule deviates.
    const seen = new Map<string, number>();
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      trials: 3,
      classifyRule: async ({ rule }) => {
        const n = (seen.get(rule.ruleId) ?? 0) + 1;
        seen.set(rule.ruleId, n);
        const expected = firstCase.expected[rule.ruleId];
        const kind = n === 3 ? "acceptable_deviation" : expected;
        return { answers: synthesizeAnswers(rule as never, kind as never) };
      },
    });
    expect(result.cases[0]?.score.pass).toBe(true);
    for (const r of result.cases[0].perRule) {
      expect(r.samples).toHaveLength(3);
      // A rule whose fixture expectation is already acceptable_deviation stays
      // stable; every other rule splits 2:1.
      expect(r.stable).toBe(firstCase.expected[r.ruleId] === "acceptable_deviation");
    }
  });

  it("breaks a tie toward the more conservative verdict", async () => {
    const seen = new Map<string, number>();
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      trials: 2,
      classifyRule: async ({ rule }) => {
        const n = (seen.get(rule.ruleId) ?? 0) + 1;
        seen.set(rule.ruleId, n);
        const kind = n === 1 ? "compliant" : "acceptable_deviation";
        return { answers: synthesizeAnswers(rule as never, kind as never) };
      },
    });
    for (const r of result.cases[0].perRule) {
      expect(r.kind).toBe("acceptable_deviation");
    }
    expect(result.cases[0]?.score.pass).toBe(false);
  });

  it("marks a fully agreeing rule as stable", async () => {
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      trials: 2,
      classifyRule: perfectClassifier(),
    });
    for (const r of result.cases[0].perRule) {
      expect(r.stable).toBe(true);
    }
    expect(result.totalCalls).toBe(filterRulesForPaper(CN_SALES_RULES, firstCase.paper).length * 2);
  });
});

describe("infrastructure errors invalidate the run", () => {
  it("classifies balance/auth/network errors, not ordinary failures", () => {
    expect(
      isInfrastructureError('Model API error 402: {"error":{"message":"Insufficient Balance"}}'),
    ).toBe(true);
    expect(isInfrastructureError("401 Unauthorized")).toBe(true);
    expect(isInfrastructureError("429 rate limit exceeded")).toBe(true);
    expect(isInfrastructureError("ECONNREFUSED 127.0.0.1:8080")).toBe(true);
    // A malformed model answer is NOT an infra error: the run is still valid.
    expect(isInfrastructureError("worker returned no verdictAnswers")).toBe(false);
    expect(isInfrastructureError("rule has no criteria")).toBe(false);
  });

  it("stops the arm on a 402 instead of burning calls on the remaining cases", async () => {
    const result = await runRuleAllPassModelArm({
      cases: loaded.cases,
      chatModel: model,
      concurrency: 1,
      classifyRule: async () => ({
        error: 'Model API error 402: {"error":{"message":"Insufficient Balance"}}',
      }),
    });
    expect(result.stoppedEarly).toBe(true);
    expect(result.infraError).toContain("402");
    // One case was attempted; the rest must not be called.
    expect(result.cases).toHaveLength(1);
  });

  it("does not set infraError for ordinary model failures", async () => {
    const result = await runRuleAllPassModelArm({
      cases: [firstCase],
      chatModel: model,
      classifyRule: async () => ({ error: "worker returned no verdictAnswers" }),
    });
    expect(result.infraError).toBeUndefined();
    expect(result.failures.length).toBeGreaterThan(0);
  });
});

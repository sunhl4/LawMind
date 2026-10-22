import { describe, expect, it } from "vitest";
import type { AgentModelConfig } from "../agent/types.js";
import { CN_SALES_RULES } from "../review/playbooks/cn-sales.js";
import { filterRulesForPaper, type RuleClassification } from "../review/rules.js";
import { buildRuleGoal, runRuleAllPassModelArm } from "./rule-allpass-model-arm.js";
import { loadRuleAllPassFixtures, oracleClassifications } from "./rule-allpass.js";

const model: AgentModelConfig = {
  provider: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
};

const loaded = loadRuleAllPassFixtures();
const firstCase = loaded.cases[0];

/** Answers correctly, like a perfect model would. */
function perfectClassifier() {
  return async ({ rule }: { rule: { ruleId: string } }) => {
    const kind = firstCase.expected[rule.ruleId];
    if (!kind) {
      return { error: `no expectation for ${rule.ruleId}` };
    }
    return { classification: { ruleId: rule.ruleId, kind } satisfies RuleClassification };
  };
}

describe("buildRuleGoal", () => {
  it("carries the rule's own standard, fallbacks and guidance", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "dispute.forum.counterparty")!;
    const goal = buildRuleGoal(rule);
    expect(goal).toContain(rule.ruleId);
    expect(goal).toContain(rule.standard);
    expect(goal).toContain("永不接受");
    expect(goal).toContain("只交回这一条规则");
  });

  it("tells the worker that an absent clause is unacceptable when the rule forbids absence", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "liability.cap.counterparty")!;
    expect(rule.absentAllowed).toBe(false);
    expect(buildRuleGoal(rule)).toContain("判 unacceptable（本规则不允许缺失）");
  });

  it("does not turn absence into a defect when the rule allows it", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "termination.symmetry.counterparty")!;
    expect(rule.absentAllowed).toBe(true);
    expect(buildRuleGoal(rule)).toContain("判 absent（absent 是最终结论");
  });

  it("orders the verdict ladder so compliant is not skipped for acceptable", () => {
    const rule = CN_SALES_RULES.find(
      (r) => r.ruleId === "confidentiality.noncompete.counterparty",
    )!;
    const goal = buildRuleGoal(rule);
    const absentAt = goal.indexOf("判 absent");
    const unacceptableAt = goal.indexOf("永不接受）");
    const acceptableAt = goal.indexOf("判 acceptable_deviation");
    const compliantAt = goal.indexOf("判 compliant");
    expect(absentAt).toBeGreaterThan(-1);
    expect(acceptableAt).toBeGreaterThan(unacceptableAt);
    expect(compliantAt).toBeGreaterThan(acceptableAt);
  });

  it("states the sufficient conditions for compliant so verdicts do not drift", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "liability.cap.counterparty")!;
    expect(rule.compliantWhen?.length).toBeGreaterThan(0);
    const goal = buildRuleGoal(rule);
    expect(goal).toContain("以下条件全部满足");
    expect(goal).toContain("不得作为降档理由");
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
        return { classification: { ruleId: rule.ruleId, kind } };
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
          return { error: "worker returned no valid classification" };
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
        const found = oracleClassifications(firstCase).find((c) => c.ruleId === rule.ruleId);
        return found ? { classification: found } : { error: "missing" };
      },
    });
    expect(result.cases[0]?.score.pass).toBe(true);
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
        return { classification: { ruleId: rule.ruleId, kind } };
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
        return { classification: { ruleId: rule.ruleId, kind } };
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

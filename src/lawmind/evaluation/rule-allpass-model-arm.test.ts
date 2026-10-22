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
    expect(buildRuleGoal(rule)).toContain("不得判 compliant");
  });

  it("does not turn absence into a defect when the rule allows it", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "termination.symmetry.counterparty")!;
    expect(rule.absentAllowed).toBe(true);
    expect(buildRuleGoal(rule)).toContain("判 absent 不算缺陷");
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

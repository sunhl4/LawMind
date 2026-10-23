import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CN_SALES_RULES } from "../review/playbooks/cn-sales.js";
import { filterRulesForPaper, type RuleClassification } from "../review/rules.js";
import {
  buildRuleAllPassReportMarkdown,
  loadRuleAllPassFixtures,
  hashRules,
  oracleClassifications,
  summarizeStability,
  resolveRuleAllPassDir,
  scoreRuleAllPassCase,
  summarizeRuleAllPass,
  validateRuleAllPassFixtures,
  type RuleAllPassCase,
  type RuleAllPassModelArmSummary,
  type RuleAllPassReport,
} from "./rule-allpass.js";

let tmp = "";
afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  }
});

function fixtureCase(partial?: Partial<RuleAllPassCase>): RuleAllPassCase {
  const expected: Record<string, string> = {};
  for (const rule of filterRulesForPaper(CN_SALES_RULES, "counterparty")) {
    expected[rule.ruleId] = "compliant";
  }
  return {
    caseId: "case-1",
    paper: "counterparty",
    contract: "第一条 本合同为合成测试合同。".repeat(12),
    expected: expected as RuleAllPassCase["expected"],
    ...partial,
  };
}

describe("in-repo fixtures", () => {
  const loaded = loadRuleAllPassFixtures();

  it("loads dev cases plus the hold-out set with no integrity problems", () => {
    expect(loaded.problems).toEqual([]);
    // 20 dev cases + 6 hold-out cases (holdout.json).
    expect(loaded.cases).toHaveLength(26);
    expect(validateRuleAllPassFixtures(loaded)).toEqual([]);
  });

  it("keeps a non-empty hold-out set that is not marked as tuned", () => {
    const holdout = loaded.cases.filter((c) => c.tunedOn !== true);
    expect(holdout.length).toBeGreaterThan(0);
    // Hold-out cases are authored before the run and must stay untouched.
    expect(holdout.map((c) => c.caseId)).toContain("h01");
  });

  it("every case covers exactly the rules applicable to its paper", () => {
    for (const c of loaded.cases) {
      const applicable = filterRulesForPaper(CN_SALES_RULES, c.paper).map((r) => r.ruleId);
      expect(Object.keys(c.expected).toSorted()).toEqual(applicable.toSorted());
    }
  });

  it("expectations exercise every verdict kind", () => {
    const kinds = new Set<string>();
    for (const c of loaded.cases) {
      for (const kind of Object.values(c.expected)) {
        kinds.add(kind);
      }
    }
    expect(kinds).toContain("compliant");
    expect(kinds).toContain("acceptable_deviation");
    expect(kinds).toContain("unacceptable");
    expect(kinds).toContain("absent");
  });

  it("has a directory resolver that points at fixtures/lawmind-allpass", () => {
    expect(resolveRuleAllPassDir()).toContain(path.join("fixtures", "lawmind-allpass"));
  });
});

describe("scoreRuleAllPassCase", () => {
  it("passes only when every rule matches", () => {
    const c = fixtureCase();
    const result = scoreRuleAllPassCase(c, oracleClassifications(c));
    expect(result.pass).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.mismatches).toEqual([]);
  });

  it("fails when a single rule is misclassified (all-pass, not average)", () => {
    const c = fixtureCase();
    const actual: RuleClassification[] = Object.entries(c.expected).map(([ruleId, kind]) => ({
      ruleId,
      kind: ruleId === "liability.cap.counterparty" ? "acceptable_deviation" : kind,
    }));
    const result = scoreRuleAllPassCase(c, actual);
    expect(result.pass).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.ruleId).toBe("liability.cap.counterparty");
  });

  it("counts a missing verdict as failure, never as an implicit pass", () => {
    const c = fixtureCase();
    const actual = oracleClassifications(c).filter(
      (item) => item.ruleId !== "dispute.forum.counterparty",
    );
    const result = scoreRuleAllPassCase(c, actual);
    expect(result.pass).toBe(false);
    expect(result.missing).toEqual(["dispute.forum.counterparty"]);
  });

  it("flags verdicts for rules outside the fixture", () => {
    const c = fixtureCase();
    const actual: RuleClassification[] = [
      ...oracleClassifications(c),
      { ruleId: "not.in.playbook", kind: "compliant" },
    ];
    const result = scoreRuleAllPassCase(c, actual);
    expect(result.pass).toBe(false);
    expect(result.extra).toEqual(["not.in.playbook"]);
  });

  it("keeps the first verdict when a rule is reported twice", () => {
    const c = fixtureCase();
    const actual: RuleClassification[] = [
      { ruleId: "liability.cap.counterparty", kind: "unacceptable" },
      { ruleId: "liability.cap.counterparty", kind: "compliant" },
    ];
    const result = scoreRuleAllPassCase(c, actual);
    expect(result.mismatches[0]?.actual).toBe("unacceptable");
  });
});

describe("summarizeRuleAllPass", () => {
  it("reports per-rule accuracy and all-pass rate", () => {
    const a = fixtureCase({ caseId: "a" });
    const b = fixtureCase({ caseId: "b" });
    const scoreA = scoreRuleAllPassCase(a, oracleClassifications(a));
    const scoreB = scoreRuleAllPassCase(
      b,
      oracleClassifications(b).map((item) =>
        item.ruleId === "payment.acceptance.counterparty"
          ? { ...item, kind: "unacceptable" as const }
          : item,
      ),
    );
    const summary = summarizeRuleAllPass([a, b], [scoreA, scoreB]);
    expect(summary.cases).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.allPassRate).toBe(0.5);
    const payment = summary.byRule.find((r) => r.ruleId === "payment.acceptance.counterparty");
    expect(payment?.correct).toBe(1);
    expect(payment?.cases).toBe(2);
  });
});

describe("fixture loading failures", () => {
  it("reports a missing directory instead of throwing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-allpass-empty-"));
    const loaded = loadRuleAllPassFixtures({ dir: path.join(tmp, "nope") });
    expect(loaded.cases).toEqual([]);
    expect(loaded.problems[0]?.problem).toContain("缺夹具文件");
  });

  it("rejects a case whose expectation omits an applicable rule", () => {
    const incomplete = fixtureCase();
    delete (incomplete.expected as Record<string, string>)["ip.data.counterparty"];
    const problems = validateRuleAllPassFixtures({
      dir: "x",
      playbookId: "cn-sales-v0",
      note: "",
      cases: [incomplete],
      problems: [],
    });
    expect(problems.some((p) => p.problem.includes("缺规则 ip.data.counterparty"))).toBe(true);
  });

  it("rejects a rule that does not apply to the case's paper", () => {
    const wrong = fixtureCase({ paper: "own" });
    const problems = validateRuleAllPassFixtures({
      dir: "x",
      playbookId: "cn-sales-v0",
      note: "",
      cases: [wrong],
      problems: [],
    });
    expect(problems.some((p) => p.problem.includes("不适用于 own 纸别"))).toBe(true);
  });

  it("rejects an unknown verdict kind at load time", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-allpass-bad-"));
    fs.writeFileSync(
      path.join(tmp, "cases.json"),
      JSON.stringify({
        playbookId: "cn-sales-v0",
        cases: [
          {
            caseId: "bad",
            paper: "counterparty",
            clauses: ["正文".repeat(200)],
            expected: { "liability.cap.counterparty": "looks_fine" },
          },
        ],
      }),
      "utf8",
    );
    const loaded = loadRuleAllPassFixtures({ dir: tmp });
    expect(loaded.cases).toEqual([]);
    expect(loaded.problems.some((p) => p.problem.includes("期望值非法"))).toBe(true);
  });

  it("rejects a contract that is too short to exercise a rule", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-allpass-short-"));
    fs.writeFileSync(
      path.join(tmp, "cases.json"),
      JSON.stringify({
        cases: [
          {
            caseId: "short",
            paper: "counterparty",
            clauses: ["太短"],
            expected: { "liability.cap.counterparty": "compliant" },
          },
        ],
      }),
      "utf8",
    );
    const loaded = loadRuleAllPassFixtures({ dir: tmp });
    expect(loaded.problems.some((p) => p.problem.includes("正文过短"))).toBe(true);
  });
});

describe("report markdown", () => {
  it("marks the oracle arm as a harness self-test", () => {
    const c = fixtureCase();
    const score = scoreRuleAllPassCase(c, oracleClassifications(c));
    const report: RuleAllPassReport = {
      generatedAt: "2026-10-22T00:00:00.000Z",
      status: "pass",
      dir: resolveRuleAllPassDir(),
      arm: "oracle",
      summary: summarizeRuleAllPass([c], [score]),
      harnessSelfTest: true,
      reportZh: "",
    };
    const md = buildRuleAllPassReportMarkdown(report);
    expect(md).toContain("oracle 自检");
    expect(md).toContain("不代表任何模型质量");
    expect(md).toContain("liability.cap.counterparty");
  });

  it("skip mode prints no accuracy at all", () => {
    const c = fixtureCase();
    const md = buildRuleAllPassReportMarkdown({
      generatedAt: "2026-10-22T00:00:00.000Z",
      status: "skip",
      dir: resolveRuleAllPassDir(),
      summary: summarizeRuleAllPass([c], []),
      harnessSelfTest: false,
      reportZh: "",
    });
    expect(md).toContain("SKIP");
    expect(md).not.toContain("all-pass 率");
    expect(md).not.toContain("| 准确率 |");
  });

  it("validate mode states that no scoring happened", () => {
    const c = fixtureCase();
    const md = buildRuleAllPassReportMarkdown({
      generatedAt: "2026-10-22T00:00:00.000Z",
      status: "pass",
      mode: "validate",
      dir: resolveRuleAllPassDir(),
      summary: summarizeRuleAllPass([c], []),
      harnessSelfTest: false,
      reportZh: "",
    });
    expect(md).toContain("不执行评分");
    expect(md).not.toContain("| 准确率 |");
  });
});

describe("stability gates the accuracy claim", () => {
  function modelArmWith(stableFlags: boolean[]): RuleAllPassModelArmSummary {
    return {
      model: "deepseek-flash",
      totalCalls: stableFlags.length * 3,
      stoppedEarly: false,
      elapsedMs: 1000,
      trials: 3,
      failures: [],
      perCase: [
        {
          caseId: "s01",
          pass: true,
          missing: [],
          mismatches: [],
          perRule: stableFlags.map((stable, i) => ({
            ruleId: `rule.${i}`,
            kind: "compliant",
            stable,
          })),
        },
      ],
    };
  }

  it("reports the unstable ratio and flags unreliable above the threshold", () => {
    const arm = modelArmWith([true, true, true, false, false, false]);
    const stability = summarizeStability(arm);
    expect(stability.totalRules).toBe(6);
    expect(stability.unstableRules).toBe(3);
    expect(stability.ratio).toBeCloseTo(0.5);
    expect(stability.unreliable).toBe(true);
  });

  it("does not flag a run inside the threshold", () => {
    const arm = modelArmWith([true, true, true, true, true, true]);
    expect(summarizeStability(arm).unreliable).toBe(false);
  });

  it("puts stability before accuracy and warns when unreliable", () => {
    const c = fixtureCase();
    const score = scoreRuleAllPassCase(c, oracleClassifications(c));
    const md = buildRuleAllPassReportMarkdown({
      generatedAt: "2026-10-22T00:00:00.000Z",
      status: "pass",
      dir: resolveRuleAllPassDir(),
      arm: "model:deepseek-flash",
      summary: summarizeRuleAllPass([c], [score]),
      harnessSelfTest: false,
      fingerprint: {
        rulesHash: "abc123",
        playbookId: "cn-sales-v0",
        model: "deepseek-flash",
        commit: "deadbee",
        trials: 3,
      },
      modelArm: modelArmWith([true, false, false, false, false, false]),
      reportZh: "",
    });
    const stabilityAt = md.indexOf("### 稳定性");
    const accuracyAt = md.indexOf("## 逐规则");
    expect(stabilityAt).toBeGreaterThan(-1);
    expect(accuracyAt).toBeGreaterThan(-1);
    expect(stabilityAt).toBeLessThan(accuracyAt);
    expect(md).toContain("衡量的是噪声");
    expect(md).toContain("deadbee");
  });

  it("marks a report without a fingerprint as non-comparable", () => {
    const c = fixtureCase();
    const score = scoreRuleAllPassCase(c, oracleClassifications(c));
    const md = buildRuleAllPassReportMarkdown({
      generatedAt: "2026-10-22T00:00:00.000Z",
      status: "pass",
      dir: resolveRuleAllPassDir(),
      arm: "model:x",
      summary: summarizeRuleAllPass([c], [score]),
      harnessSelfTest: false,
      reportZh: "",
    });
    expect(md).toContain("无运行指纹");
  });

  it("hashing rules changes when a criterion changes", () => {
    const before = hashRules(CN_SALES_RULES);
    const mutated = CN_SALES_RULES.map((r, i) =>
      i === 0
        ? {
            ...r,
            criteria: r.criteria.map((c, j) =>
              j === 0 ? { ...c, question: c.question + "？" } : c,
            ),
          }
        : r,
    );
    expect(hashRules(mutated)).not.toBe(before);
  });
});

describe("an infrastructure-aborted run may not print an accuracy", () => {
  it("replaces the rate with INVALID and points at the cause", () => {
    const c = fixtureCase();
    const score = scoreRuleAllPassCase(c, oracleClassifications(c));
    const md = buildRuleAllPassReportMarkdown({
      generatedAt: "2026-10-23T00:00:00.000Z",
      status: "fail",
      dir: resolveRuleAllPassDir(),
      arm: "model:deepseek-flash",
      summary: summarizeRuleAllPass([c], [score]),
      harnessSelfTest: false,
      fingerprint: {
        rulesHash: "abc",
        playbookId: "cn-sales-v0",
        model: "deepseek-flash",
        trials: 3,
      },
      modelArm: {
        model: "deepseek-flash",
        totalCalls: 6,
        stoppedEarly: true,
        infraError: 'Model API error 402: {"message":"Insufficient Balance"}',
        elapsedMs: 1000,
        trials: 3,
        failures: [{ caseId: "s01", ruleId: "x", error: "402" }],
        perCase: [],
      },
      generalization: { cases: 0, passed: 0, allPassRate: 0, caseIds: [] },
      reportZh: "",
    });
    expect(md).toContain("INVALID");
    expect(md).toContain("Insufficient Balance");
    expect(md).not.toContain("all-pass 率");
    // The generalisation section must not appear on an invalid run.
    expect(md).not.toContain("## 泛化");
  });
});

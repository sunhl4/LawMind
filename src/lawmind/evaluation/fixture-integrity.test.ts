import { describe, expect, it } from "vitest";
import { CN_SALES_RULES } from "../review/playbooks/cn-sales.js";
import { filterRulesForPaper, type ReviewRule } from "../review/rules.js";
import {
  checkFixtureCase,
  checkFixtures,
  checkRuleCriteria,
  formatIntegrityFindings,
  type IntegrityFinding,
} from "./fixture-integrity.js";
import { loadRuleAllPassFixtures, type RuleAllPassCase } from "./rule-allpass.js";

function expectedFor(paper: "own" | "counterparty"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of filterRulesForPaper(CN_SALES_RULES, paper)) {
    out[rule.ruleId] = "compliant";
  }
  return out;
}

function fixture(partial: Partial<RuleAllPassCase> & { clauses: string[] }): RuleAllPassCase {
  return {
    caseId: "case-x",
    paper: "counterparty",
    expected: expectedFor("counterparty") as RuleAllPassCase["expected"],
    ...partial,
    clauses: partial.clauses,
    contract: partial.contract ?? partial.clauses.join("\n"),
  };
}

function codes(findings: IntegrityFinding[]): string[] {
  return findings.map((f) => f.code);
}

describe("in-repo fixtures are clean", () => {
  const loaded = loadRuleAllPassFixtures();

  it("passes every integrity check", () => {
    expect(loaded.problems).toEqual([]);
    const findings = checkFixtures(loaded.cases, CN_SALES_RULES);
    // If this fails, the message names the exact sentence to fix.
    expect(formatIntegrityFindings(findings)).toBe("");
  });

  it("has no duplicate criterion questions across the playbook", () => {
    expect(checkRuleCriteria(CN_SALES_RULES)).toEqual([]);
  });
});

describe("dangling attachment reference", () => {
  it("flags 「以附件一为准」 with no 附件一 block", () => {
    const findings = checkFixtureCase(
      fixture({
        clauses: [
          "第一条 标的。买卖双方约定货物一批并明确总价款。",
          "第二条 验收。验收标准以本合同附件一为准，双方共同验收后付款。",
        ],
      }),
      CN_SALES_RULES,
    );
    expect(codes(findings)).toContain("dangling_attachment");
    expect(findings[0]?.problem).toContain("附件一");
  });

  it("accepts a reference when the attachment block is present", () => {
    const findings = checkFixtureCase(
      fixture({
        clauses: [
          "第一条 标的。买卖双方约定货物一批并明确总价款。",
          "第二条 验收。验收标准以本合同附件一为准。",
          "附件一 验收标准：数量以交货单为准，质量以国家标准为准。",
        ],
      }),
      CN_SALES_RULES,
    );
    expect(codes(findings)).not.toContain("dangling_attachment");
  });
});

describe("undeterminable wording", () => {
  it("flags 「按法律规定」", () => {
    const findings = checkFixtureCase(
      fixture({
        clauses: ["第一条 标的。货物一批。", "第七条 竞业。补偿按法律规定支付。"],
      }),
      CN_SALES_RULES,
    );
    const hit = findings.find((f) => f.code === "undeterminable_wording");
    expect(hit?.problem).toContain("按法律规定");
  });

  it("flags 「另行协商」 and 「视情况」", () => {
    const findings = checkFixtureCase(
      fixture({
        clauses: ["第一条 价款另行协商。", "第二条 交付时间视情况确定。"],
      }),
      CN_SALES_RULES,
    );
    expect(codes(findings).filter((c) => c === "undeterminable_wording")).toHaveLength(2);
  });
});

describe("absent expectation needs an explicit declaration", () => {
  it("flags absent without a 「未约定」 sentence", () => {
    const expected = expectedFor("counterparty") as RuleAllPassCase["expected"];
    expected["ip.data.counterparty"] = "absent";
    const findings = checkFixtureCase(
      fixture({
        clauses: ["第一条 标的。货物一批。", "第二条 责任上限以总价款为限。"],
        expected,
      }),
      CN_SALES_RULES,
    );
    expect(codes(findings)).toContain("absent_without_declaration");
  });

  it("accepts an explicit declaration", () => {
    const expected = expectedFor("counterparty") as RuleAllPassCase["expected"];
    expected["ip.data.counterparty"] = "absent";
    const findings = checkFixtureCase(
      fixture({
        clauses: [
          "第一条 标的。货物一批。",
          "本合同未就知识产权作出任何约定，亦未约定数据使用范围。",
        ],
        expected,
      }),
      CN_SALES_RULES,
    );
    expect(codes(findings)).not.toContain("absent_without_declaration");
  });
});

describe("clause numbering gap", () => {
  it("flags 一、二、六 without a declaration", () => {
    const findings = checkFixtureCase(
      fixture({
        clauses: ["第一条 标的。", "第二条 价款。", "第六条 保密。三年。"],
      }),
      CN_SALES_RULES,
    );
    expect(codes(findings)).toContain("clause_number_gap");
  });

  it("does not flag contiguous numbering", () => {
    const findings = checkFixtureCase(
      fixture({ clauses: ["第一条 标的。", "第二条 价款。", "第三条 保密。"] }),
      CN_SALES_RULES,
    );
    expect(codes(findings)).not.toContain("clause_number_gap");
  });
});

describe("expectation must name known rules", () => {
  it("flags a rule id that is not in the playbook", () => {
    const findings = checkFixtureCase(
      fixture({
        clauses: ["第一条 标的。货物一批。"],
        expected: { "no.such.rule": "compliant" } as RuleAllPassCase["expected"],
      }),
      CN_SALES_RULES,
    );
    expect(codes(findings)).toContain("criterion_not_in_rule");
  });
});

describe("duplicate criterion questions", () => {
  it("flags two criteria asking the same thing", () => {
    const rule: ReviewRule = {
      ...CN_SALES_RULES[0],
      criteria: [
        { id: "a", question: "是否有一方不设上限？", verdictIfMet: "unacceptable" },
        { id: "b", question: "是否有一方不设上限？", verdictIfMet: "acceptable_deviation" },
        { id: "c", question: "双方上限是否一致？", verdictIfMet: "compliant" },
      ],
    };
    const findings = checkRuleCriteria([rule]);
    expect(codes(findings)).toContain("duplicate_criterion_question");
    expect(findings[0]?.problem).toContain("a");
  });
});

describe("formatIntegrityFindings", () => {
  it("names the case, the code and the sentence", () => {
    const text = formatIntegrityFindings([
      { caseId: "s01", code: "dangling_attachment", problem: "引用了「附件一」" },
    ]);
    expect(text).toContain("s01");
    expect(text).toContain("[dangling_attachment]");
    expect(text).toContain("附件一");
  });
});

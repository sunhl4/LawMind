import { describe, expect, it } from "vitest";
import type { ReviewRule } from "./rules.js";
import {
  criterionIdsOf,
  decideVerdict,
  indexAnswers,
  missingCriterionIds,
  VERDICT_STEPS,
  type CriterionAnswer,
} from "./verdict.js";

function rule(partial?: Partial<ReviewRule>): ReviewRule {
  return {
    ruleId: "demo.rule",
    title: "演示规则",
    paper: "counterparty",
    standard: "演示标准",
    source: "skills/builtin/contract-playbook-review.md#底线项-demo",
    absentAllowed: true,
    criteria: [
      { id: "bad", question: "是否存在致命缺陷？", verdictIfMet: "unacceptable" },
      { id: "meh", question: "是否存在轻微偏离？", verdictIfMet: "acceptable_deviation" },
      { id: "good1", question: "是否约定了保护条款甲？", verdictIfMet: "compliant" },
      { id: "good2", question: "是否约定了保护条款乙？", verdictIfMet: "compliant" },
    ],
    ...partial,
  };
}

function answers(map: Record<string, CriterionAnswer["met"]>): CriterionAnswer[] {
  return Object.entries(map).map(([criterionId, met]) => ({ criterionId, met }));
}

describe("decideVerdict: ladder", () => {
  it("step 1: absent when the rule allows absence", () => {
    const d = decideVerdict(rule(), { clausePresent: false, answers: [] });
    expect(d.kind).toBe("absent");
    expect(d.step).toBe("absent_allowed");
  });

  it("step 1: unacceptable when the rule forbids absence", () => {
    const d = decideVerdict(rule({ absentAllowed: false }), {
      clausePresent: false,
      answers: [],
    });
    expect(d.kind).toBe("unacceptable");
    expect(d.step).toBe("absent_forbidden");
    expect(d.risk).toBe("high");
  });

  it("step 2: any unacceptable defect wins over everything else", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: true, meh: true, good1: true, good2: true }),
    });
    expect(d.kind).toBe("unacceptable");
    expect(d.step).toBe("unacceptable_criterion");
    expect(d.rationale).toContain("是否存在致命缺陷");
  });

  it("step 3: acceptable deviation wins over compliant", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: false, meh: true, good1: true, good2: true }),
    });
    expect(d.kind).toBe("acceptable_deviation");
    expect(d.step).toBe("acceptable_criterion");
  });

  it("step 4: compliant when every positive requirement holds", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: false, meh: false, good1: true, good2: true }),
    });
    expect(d.kind).toBe("compliant");
    expect(d.step).toBe("all_compliant");
    expect(d.unresolvedCriterionIds).toEqual([]);
  });

  it("step 4: not_applicable satisfies a positive requirement", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: false, meh: false, good1: true, good2: "not_applicable" }),
    });
    expect(d.kind).toBe("compliant");
  });

  it("step 5: unknown escalates instead of tiering", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: false, meh: false, good1: "unknown", good2: true }),
    });
    expect(d.kind).toBe("needs_human");
    expect(d.step).toBe("unknown_answer");
    expect(d.unresolvedCriterionIds).toEqual(["good1"]);
    expect(d.rationale).toContain("good1");
  });

  it("step 5 beats step 6: a rule short of compliant because of unknown is escalated", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: false, meh: false, good1: false, good2: "unknown" }),
    });
    expect(d.kind).toBe("needs_human");
  });

  it("step 6: definite answers but a requirement unmet -> acceptable deviation", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: false, meh: false, good1: true, good2: false }),
    });
    expect(d.kind).toBe("acceptable_deviation");
    expect(d.step).toBe("no_compliant_requirement_met");
  });

  it("step 4: an unknown defect escalates instead of declaring compliance", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({
        bad: false,
        meh: "unknown",
        good1: true,
        good2: true,
      }),
    });
    // `meh` asks "is there a minor deviation?" — unknown cannot be read as "no".
    expect(d.kind).toBe("needs_human");
    expect(d.unresolvedCriterionIds).toEqual(["meh"]);
  });
});

describe("decideVerdict: determinism and no implicit leniency", () => {
  it("same input always yields the same verdict", () => {
    const r = rule();
    const input = {
      clausePresent: true,
      answers: answers({ bad: false, meh: false, good1: true, good2: true }),
    };
    const first = decideVerdict(r, input);
    for (let i = 0; i < 50; i += 1) {
      expect(decideVerdict(r, input)).toEqual(first);
    }
  });

  it("a missing answer is unresolved, never an implicit false", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: answers({ bad: false, meh: false, good1: true }),
    });
    expect(d.kind).toBe("needs_human");
    expect(d.unresolvedCriterionIds).toEqual(["good2"]);
  });

  it("unparsable met values are treated as missing", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: [
        { criterionId: "bad", met: "maybe" as never },
        { criterionId: "meh", met: false },
        { criterionId: "good1", met: true },
        { criterionId: "good2", met: true },
      ],
    });
    expect(d.kind).toBe("needs_human");
    expect(d.unresolvedCriterionIds).toEqual(["bad"]);
  });

  it("carries evidence through from the answers", () => {
    const d = decideVerdict(rule(), {
      clausePresent: true,
      answers: [
        { criterionId: "bad", met: true, evidence: "甲方不设上限" },
        { criterionId: "meh", met: false },
        { criterionId: "good1", met: true },
        { criterionId: "good2", met: true },
      ],
    });
    expect(d.evidence).toContain("甲方不设上限");
  });

  it("does not mutate the rule or the answers", () => {
    const r = rule();
    const input = answers({ bad: true, meh: false, good1: true, good2: true });
    const snapshot = JSON.stringify({ r, input });
    decideVerdict(r, input);
    expect(JSON.stringify({ r, input })).toBe(snapshot);
  });
});

describe("helpers", () => {
  it("indexAnswers keeps the first answer for a repeated id", () => {
    const map = indexAnswers([
      { criterionId: "a", met: true },
      { criterionId: "a", met: false },
    ]);
    expect(map.get("a")?.met).toBe(true);
  });

  it("missingCriterionIds reports unanswered ids only", () => {
    const r = rule();
    expect(missingCriterionIds(r, answers({ bad: false, good1: true }))).toEqual(["meh", "good2"]);
  });

  it("criterionIdsOf lists every criterion in declaration order", () => {
    expect(criterionIdsOf(rule())).toEqual(["bad", "meh", "good1", "good2"]);
  });

  it("VERDICT_STEPS documents the ladder in order", () => {
    expect(VERDICT_STEPS[0]).toBe("absent_allowed");
    expect(VERDICT_STEPS.at(-1)).toBe("no_compliant_requirement_met");
  });
});

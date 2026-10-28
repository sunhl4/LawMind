import { describe, expect, it } from "vitest";
import { rubricHasMustPass, scoreAllPass } from "./all-pass.js";
import type { BaselineRubric } from "./human-baseline.js";

function rubric(criteria: BaselineRubric["criteria"]): BaselineRubric {
  return { taskType: "structured_drafting", criteria };
}

describe("scoreAllPass", () => {
  it("passes only when every mustPass criterion is covered", () => {
    const r = rubric([
      { id: "cap", label: "责任上限对等", allOf: ["责任上限"], mustPass: true },
      { id: "forum", label: "管辖", anyOf: ["管辖法院", "仲裁"], mustPass: true },
    ]);
    const ok = scoreAllPass("双方责任上限对等，争议由合同履行地管辖法院管辖。", r);
    expect(ok.pass).toBe(true);
    expect(ok.failed).toEqual([]);

    const bad = scoreAllPass("双方责任上限对等。", r);
    expect(bad.pass).toBe(false);
    expect(bad.failed).toEqual(["forum"]);
  });

  it("one missed red flag fails the whole task (all-pass, not average)", () => {
    const r = rubric([
      { id: "a", label: "A", allOf: ["甲"], mustPass: true, weight: 10 },
      { id: "b", label: "B", allOf: ["乙"], mustPass: true, weight: 1 },
      { id: "c", label: "C", allOf: ["丙"], mustPass: true, weight: 1 },
    ]);
    const res = scoreAllPass("甲 丙", r);
    expect(res.pass).toBe(false);
    expect(res.failed).toEqual(["b"]);
    // coverage stays high — diagnostics must not mask the failure
    expect(res.coverage).toBeCloseTo(2 / 3);
  });

  it("mustNotAppear always fails, even if the criterion is not mustPass", () => {
    const r = rubric([
      { id: "no_uncapped", label: "不得无上限", mustNotAppear: ["无限责任"], mustPass: true },
    ]);
    expect(scoreAllPass("乙方承担无限责任。", r).pass).toBe(false);
    expect(scoreAllPass("责任以合同金额为上限。", r).pass).toBe(true);
  });

  it("non-mustPass criteria do not gate the pass", () => {
    const r = rubric([
      { id: "core", label: "核心", allOf: ["甲"], mustPass: true },
      { id: "nice", label: "加分", allOf: ["乙"] },
    ]);
    const res = scoreAllPass("甲", r);
    expect(res.pass).toBe(true);
    expect(res.coverage).toBeCloseTo(0.5);
  });

  it("a rubric with no mustPass is reported as not gated", () => {
    const legacy = rubric([{ id: "legacy", label: "旧", allOf: ["甲"] }]);
    expect(rubricHasMustPass(legacy)).toBe(false);
    expect(rubricHasMustPass(rubric([{ id: "x", label: "X", mustPass: true }]))).toBe(true);
  });
});

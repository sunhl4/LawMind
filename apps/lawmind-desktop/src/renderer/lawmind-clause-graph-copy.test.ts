import { describe, expect, it } from "vitest";
import {
  criticNotesFromReview,
  clauseGraphSummaryLine,
  clauseHasFlags,
  shouldDefaultCollapseClause,
  sortClausesForReview,
} from "./lawmind-clause-graph-copy";

describe("clause graph copy", () => {
  it("keeps only 复核 notes", () => {
    expect(criticNotesFromReview(["律师手写", "复核：缺管辖", "其他"])).toEqual(["复核：缺管辖"]);
  });

  it("summarizes graph counts", () => {
    expect(
      clauseGraphSummaryLine({
        taskId: "t1",
        clauses: [
          {
            id: "c1",
            heading: "第一条",
            body: "租金",
            kind: "article",
            risks: ["违约金"],
            missing: [],
            criticNotes: ["期限不清"],
          },
        ],
        riskCount: 1,
        missingCount: 0,
        builtAt: new Date().toISOString(),
      }),
    ).toBe("条款 1 · 风险 1 · 缺项 0 · 复核 1");
  });

  it("flags clauses with risks, missing, or critic notes", () => {
    expect(
      clauseHasFlags({
        id: "c1",
        heading: "一",
        body: "",
        kind: "heading",
        risks: [],
        missing: [],
        criticNotes: [],
      }),
    ).toBe(false);
  });

  it("sorts flagged clauses first and collapses clean ones", () => {
    const clean = {
      id: "c1",
      heading: "第一条",
      body: "房屋坐落于北京。",
      kind: "article" as const,
      risks: [],
      missing: [],
      criticNotes: [],
    };
    const flagged = {
      id: "c2",
      heading: "第二条",
      body: "逾期须支付违约金。",
      kind: "article" as const,
      risks: ["违约金"],
      missing: [],
      criticNotes: [],
    };
    const ordered = sortClausesForReview({
      taskId: "t1",
      clauses: [clean, flagged],
      riskCount: 1,
      missingCount: 0,
      builtAt: new Date().toISOString(),
    });
    expect(ordered.map((clause) => clause.id)).toEqual(["c2", "c1"]);
    expect(shouldDefaultCollapseClause(clean)).toBe(true);
    expect(shouldDefaultCollapseClause(flagged)).toBe(false);
  });
});

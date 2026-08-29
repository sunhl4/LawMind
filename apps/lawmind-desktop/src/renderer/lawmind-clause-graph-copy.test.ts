import { describe, expect, it } from "vitest";
import type { ClauseGraph } from "../../../../src/lawmind/reasoning/clause-graph.ts";
import {
  criticNotesFromReview,
  shouldDefaultCollapseClause,
  shouldShowClauseGraph,
  sortClausesForReview,
} from "./lawmind-clause-graph-copy";

const graph: ClauseGraph = {
  taskId: "t1",
  builtAt: new Date().toISOString(),
  riskCount: 1,
  missingCount: 1,
  clauses: [
    {
      id: "c1",
      heading: "干净条款",
      body: "房屋坐落于北京。",
      kind: "heading",
      risks: [],
      missing: [],
      criticNotes: [],
    },
    {
      id: "c2",
      heading: "风险条款",
      body: "违约金过高。",
      kind: "article",
      risks: ["违约"],
      missing: [],
      criticNotes: ["复核只加意见"],
    },
  ],
};

describe("lawmind-clause-graph-copy", () => {
  it("puts flagged clauses first and collapses clean ones", () => {
    const ordered = sortClausesForReview(graph);
    expect(ordered[0]?.id).toBe("c2");
    expect(shouldDefaultCollapseClause(graph.clauses[0])).toBe(true);
    expect(shouldDefaultCollapseClause(graph.clauses[1])).toBe(false);
  });

  it("only keeps critic notes that start with 复核：", () => {
    expect(criticNotesFromReview(["复核：缺管辖", "骨架稿：模型未成稿"])).toEqual(["复核：缺管辖"]);
  });

  it("shows clause graph for contracts, or only when flagged", () => {
    expect(shouldShowClauseGraph(graph, "contract.review")).toBe(true);
    expect(shouldShowClauseGraph(graph, "memo.internal")).toBe(true);
    const clean: ClauseGraph = {
      ...graph,
      riskCount: 0,
      missingCount: 0,
      clauses: graph.clauses.map((c) => ({ ...c, risks: [], missing: [], criticNotes: [] })),
    };
    expect(shouldShowClauseGraph(clean, "memo.internal")).toBe(false);
    expect(shouldShowClauseGraph(clean, "letter.counsel")).toBe(true);
  });
});

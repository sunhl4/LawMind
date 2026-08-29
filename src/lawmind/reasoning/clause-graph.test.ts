import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  attachClauseCriticNotes,
  buildClauseGraphFromDraft,
  clauseGraphHeadline,
  splitClauseText,
} from "./clause-graph.js";

describe("clause-graph", () => {
  it("splits 第×条 into clause nodes", () => {
    const nodes = splitClauseText(
      "第一条 租赁物\n房屋坐落于北京。\n第二条 违约金\n逾期须支付违约金。",
    );
    expect(nodes.length).toBe(2);
    expect(nodes[0]?.heading).toContain("第一条");
    expect(nodes[1]?.risks).toContain("违约金");
  });

  it("builds a graph from draft sections and never rewrites body", () => {
    const draft: ArtifactDraft = {
      taskId: "t-clause-1",
      title: "租赁合同",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.rental",
      summary: "测",
      sections: [
        { heading: "租金", body: "乙方应当按时支付租金。" },
        { heading: "争议解决", body: "向有管辖权的人民法院起诉。" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    const graph = buildClauseGraphFromDraft(draft);
    expect(graph.clauses.length).toBeGreaterThanOrEqual(2);
    expect(graph.clauses.some((c) => c.missing.includes("有义务表述，但未写后果"))).toBe(true);
    expect(graph.clauses.every((c) => Array.isArray(c.criticNotes))).toBe(true);
    const withNotes = attachClauseCriticNotes(
      graph,
      new Map([[graph.clauses[0]?.id ?? "c1", ["模型只加意见"]]]),
    );
    expect(withNotes.clauses[0]?.criticNotes).toContain("模型只加意见");
    expect(withNotes.clauses[0]?.body).toBe(graph.clauses[0]?.body);
    expect(clauseGraphHeadline(withNotes)).toContain("复核 1");
  });
});

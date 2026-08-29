import { describe, expect, it } from "vitest";
import type { ResearchBundle } from "../types.js";
import { evaluateResearchEvidenceGate } from "./research-evidence-gate.js";

function bundle(partial: Partial<ResearchBundle> = {}): ResearchBundle {
  return {
    taskId: "t1",
    query: "q",
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
    ...partial,
  };
}

const usableClaim = {
  text: "电池法规适用于出口欧盟新能源汽车",
  sourceIds: ["s1"],
  confidence: 0.8,
  model: "legal" as const,
};

describe("evaluateResearchEvidenceGate", () => {
  it("allows non-outline-gated types", () => {
    const r = evaluateResearchEvidenceGate({
      deliverableType: "report.esg",
      bundle: bundle(),
    });
    expect(r.block).toBe(false);
  });

  it("blocks empty claims for compliance", () => {
    const r = evaluateResearchEvidenceGate({
      deliverableType: "report.compliance",
      bundle: bundle({ sources: [{ id: "s1", title: "orphan", kind: "web" }] }),
      allowWebSearch: false,
    });
    expect(r.block).toBe(true);
    expect(r.gateDecision?.gate).toBe("research_evidence_gate");
    expect(r.nextActions).toContain("enable_web_search");
  });

  it("blocks demo corpus for learning", () => {
    const r = evaluateResearchEvidenceGate({
      deliverableType: "report.learning",
      bundle: bundle({
        sources: [
          {
            id: "s1",
            title: "demo",
            kind: "statute",
            demo: true,
          },
        ],
        claims: [
          {
            text: "演示结论",
            sourceIds: ["s1"],
            confidence: 0.5,
            model: "general",
            demo: true,
          },
        ],
      }),
    });
    expect(r.block).toBe(true);
  });

  it("allows ready evidence", () => {
    const r = evaluateResearchEvidenceGate({
      deliverableType: "report.compliance",
      bundle: bundle({
        sources: [{ id: "s1", title: "EU Battery Reg", kind: "regulation" }],
        claims: [usableClaim],
      }),
      allowWebSearch: true,
    });
    expect(r.block).toBe(false);
  });

  it("allows after partial topic filter (soft riskFlag must not hard-block)", () => {
    const r = evaluateResearchEvidenceGate({
      deliverableType: "report.compliance",
      bundle: bundle({
        sources: [{ id: "s1", title: "EU Battery Reg", kind: "regulation" }],
        claims: [usableClaim],
        riskFlags: ["已过滤 1 条与主题无关的检索结论"],
      }),
      allowWebSearch: true,
    });
    expect(r.block).toBe(false);
  });

  it("allows usable local evidence when web search is off (soft hint CTA only)", () => {
    const r = evaluateResearchEvidenceGate({
      deliverableType: "report.compliance",
      bundle: bundle({
        sources: [{ id: "s1", title: "EU Battery Reg", kind: "regulation" }],
        claims: [usableClaim],
        riskFlags: ["深度研究：allowWebSearch 未开启，已跳过 URL 抓取（仅用本地/权威适配器）"],
      }),
      allowWebSearch: false,
    });
    expect(r.block).toBe(false);
    expect(r.nextActions).toContain("enable_web_search");
  });

  it("allows usable evidence after degraded model JSON soft flag", () => {
    const r = evaluateResearchEvidenceGate({
      deliverableType: "report.compliance",
      bundle: bundle({
        sources: [{ id: "s1", title: "EU Battery Reg", kind: "regulation" }],
        claims: [usableClaim],
        riskFlags: ["模型未返回合法 JSON，已降级为关键词起草"],
      }),
      allowWebSearch: true,
    });
    expect(r.block).toBe(false);
  });
});

/**
 * Quality metrics unit tests (Phase B).
 */

import { describe, expect, it } from "vitest";
import type { ArtifactDraft, LegalReasoningGraph, ResearchBundle } from "../types.js";
import {
  computeCitationValidityRate,
  computeIssueCoverageRate,
  computeRiskRecallRate,
} from "./metrics.js";

function draft(sections: ArtifactDraft["sections"]): ArtifactDraft {
  return {
    taskId: "t1",
    title: "T",
    output: "docx",
    templateId: "tmpl",
    summary: "S",
    sections,
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

describe("computeCitationValidityRate", () => {
  it("returns null when draft has no citations", () => {
    const bundle: ResearchBundle = {
      taskId: "t1",
      query: "q",
      sources: [{ id: "a", title: "A", kind: "statute" }],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    };
    expect(computeCitationValidityRate(draft([{ heading: "H", body: "x" }]), bundle)).toBeNull();
  });

  it("counts valid vs total citations", () => {
    const bundle: ResearchBundle = {
      taskId: "t1",
      query: "q",
      sources: [
        { id: "s1", title: "A", kind: "statute" },
        { id: "s2", title: "B", kind: "case" },
      ],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    };
    const d = draft([
      { heading: "1", body: "b", citations: ["s1", "bad"] },
      { heading: "2", body: "c", citations: ["s2"] },
    ]);
    expect(computeCitationValidityRate(d, bundle)).toBeCloseTo(2 / 3, 2);
  });
});

describe("computeRiskRecallRate", () => {
  it("returns null when no risk flags", () => {
    const bundle: ResearchBundle = {
      taskId: "t1",
      query: "q",
      sources: [],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    };
    expect(computeRiskRecallRate(draft([{ heading: "H", body: "违约金" }]), bundle)).toBeNull();
  });

  it("detects keyword overlap with draft text", () => {
    const bundle: ResearchBundle = {
      taskId: "t1",
      query: "q",
      sources: [],
      claims: [],
      riskFlags: ["违约金可能被调减", "管辖存在争议"],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    };
    const d = draft([{ heading: "风险", body: "本案违约金可能被法院调减，且管辖存在争议。" }]);
    expect(computeRiskRecallRate(d, bundle)).toBe(1);
  });
});

describe("computeIssueCoverageRate", () => {
  it("returns null for empty issue tree", () => {
    const graph: LegalReasoningGraph = {
      taskId: "t1",
      issueTree: [],
      argumentMatrix: [],
      authorityConflicts: [],
      deliveryRisks: [],
      overallConfidence: 0,
      builtAt: new Date().toISOString(),
    };
    expect(computeIssueCoverageRate(draft([{ heading: "H", body: "x" }]), graph)).toBeNull();
  });

  it("scores coverage when draft mentions issue probes", () => {
    const graph: LegalReasoningGraph = {
      taskId: "t1",
      issueTree: [
        {
          issue: "争点 1：合同效力是否成立",
          elements: [],
          facts: [],
          evidence: [],
          authorityIds: [],
          openQuestions: [],
          confidence: 0.8,
        },
      ],
      argumentMatrix: [],
      authorityConflicts: [],
      deliveryRisks: [],
      overallConfidence: 0.8,
      builtAt: new Date().toISOString(),
    };
    const d = draft([{ heading: "争点", body: "关于合同效力是否成立，本院认为……" }]);
    expect(computeIssueCoverageRate(d, graph)).toBeGreaterThan(0);
  });
});

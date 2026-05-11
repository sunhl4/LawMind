import { describe, expect, it } from "vitest";
import type { LegalReasoningGraph } from "../types.js";
import { validateReasoningAgainstSpec } from "./reasoning-validator.js";

function buildGraph(overrides: Partial<LegalReasoningGraph> = {}): LegalReasoningGraph {
  return {
    taskId: "t-1",
    matterId: "m-1",
    issueTree: [
      {
        issue: "issue-A",
        elements: ["e1"],
        facts: ["fact-1", "fact-2"],
        evidence: ["ev-1"],
        authorityIds: ["auth-1"],
        openQuestions: [],
        confidence: 0.7,
      },
    ],
    argumentMatrix: [],
    authorityConflicts: [],
    deliveryRisks: [],
    overallConfidence: 0.7,
    builtAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("reasoning-validator", () => {
  it("returns required=false when spec has no reasoningGate (informational only)", () => {
    const report = validateReasoningAgainstSpec(buildGraph(), "document.general");
    expect(report.required).toBe(false);
    expect(report.ready).toBe(true);
  });

  it("required=true with passing graph reports ready", () => {
    const report = validateReasoningAgainstSpec(
      buildGraph({
        issueTree: [
          {
            issue: "i1",
            elements: [],
            facts: ["f1", "f2"],
            evidence: [],
            authorityIds: ["a1"],
            openQuestions: [],
            confidence: 0.7,
          },
          {
            issue: "i2",
            elements: [],
            facts: ["f3"],
            evidence: [],
            authorityIds: ["a2"],
            openQuestions: [],
            confidence: 0.6,
          },
        ],
        overallConfidence: 0.65,
      }),
      "letter.demand",
    );
    expect(report.required).toBe(true);
    expect(report.ready).toBe(true);
  });

  it("required=true with single issue blocks render (minIssues=2 default for high-risk)", () => {
    const report = validateReasoningAgainstSpec(
      buildGraph({ overallConfidence: 0.5 }),
      "letter.demand",
    );
    expect(report.required).toBe(true);
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.key === "min_issues")?.passed).toBe(false);
  });

  it("required=true with unresolved authority conflicts blocks render", () => {
    const report = validateReasoningAgainstSpec(
      buildGraph({
        issueTree: [
          {
            issue: "i1",
            elements: [],
            facts: ["f"],
            evidence: [],
            authorityIds: ["a1"],
            openQuestions: [],
            confidence: 0.5,
          },
          {
            issue: "i2",
            elements: [],
            facts: ["f"],
            evidence: [],
            authorityIds: ["a2"],
            openQuestions: [],
            confidence: 0.5,
          },
        ],
        authorityConflicts: [{ authorityIds: ["a1", "a2"], conflict: "conflict", resolved: false }],
        overallConfidence: 0.6,
      }),
      "letter.demand",
    );
    expect(report.required).toBe(true);
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.key === "authority_conflicts_resolved")?.passed).toBe(false);
  });

  it("missing graph but required=true → blocks", () => {
    const report = validateReasoningAgainstSpec(undefined, "letter.demand");
    expect(report.required).toBe(true);
    expect(report.ready).toBe(false);
    expect(report.checks[0].key).toBe("graph_present");
  });

  it("missing graph and required=false → soft warning, ready=true", () => {
    const report = validateReasoningAgainstSpec(undefined, "document.general");
    expect(report.required).toBe(false);
    expect(report.ready).toBe(true);
  });
});

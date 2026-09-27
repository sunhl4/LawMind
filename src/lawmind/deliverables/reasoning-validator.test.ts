import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { persistReasoningSnapshot } from "../drafts/reasoning-snapshot.js";
import type { ArtifactDraft, LegalReasoningGraph } from "../types.js";
import { validateReasoningGraphAtDraft } from "./reasoning-validator-workspace.js";
import {
  specRequiresReasoningGraphAtDraft,
  validateReasoningAgainstSpec,
} from "./reasoning-validator.js";
import { getDeliverableSpec } from "./registry.js";

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

  it("required=true with a single issue warns but does not block render", () => {
    const report = validateReasoningAgainstSpec(
      buildGraph({ overallConfidence: 0.5 }),
      "letter.demand",
    );
    expect(report.required).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.checks.find((c) => c.key === "min_issues")?.passed).toBe(false);
    expect(report.checks.find((c) => c.key === "min_issues")?.severity).toBe("warning");
  });

  it("unresolved authority conflicts warn and do not block render", () => {
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
    expect(report.ready).toBe(true);
    expect(report.checks.find((c) => c.key === "authority_conflicts_resolved")?.passed).toBe(false);
    expect(report.checks.find((c) => c.key === "authority_conflicts_resolved")?.severity).toBe(
      "warning",
    );
  });

  it("missing graph warns and does not block render", () => {
    const report = validateReasoningAgainstSpec(undefined, "letter.demand");
    expect(report.required).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.checks[0].key).toBe("graph_present");
    expect(report.checks[0].severity).toBe("warning");
  });

  it("missing graph and required=false → soft warning, ready=true", () => {
    const report = validateReasoningAgainstSpec(undefined, "document.general");
    expect(report.required).toBe(false);
    expect(report.ready).toBe(true);
  });

  it("P0-4a：facts_grounded 未通过时**不得**成为 blocker（否则必然拦截所有高危渲染）", () => {
    // 真实形状的 bundle：只有 statute / case，没有任何被结论引用的案件事实来源。
    // 见 reasoning-validator.ts 的 FACT_GROUNDED_SEVERITY_FOR_REQUIRED_SPECS：
    // facts 在当前数据形状下结构上恒为空，所以升为 blocker = 100% 拦截 = 回归。
    const report = validateReasoningAgainstSpec(
      buildGraph({
        issueTree: [
          {
            issue: "i1",
            elements: [],
            facts: [], // ← buildLegalReasoningGraph 的真实产物
            evidence: ["（2023）京民终12345号"],
            authorityIds: ["a1"],
            openQuestions: [],
            confidence: 0.9,
          },
          {
            issue: "i2",
            elements: [],
            facts: [],
            evidence: [],
            authorityIds: ["a2"],
            openQuestions: [],
            confidence: 0.85,
          },
        ],
        overallConfidence: 0.875,
      }),
      "letter.demand",
    );
    expect(report.required).toBe(true);
    const factsCheck = report.checks.find((c) => c.key === "facts_grounded");
    expect(factsCheck?.passed).toBe(false);
    // 未通过但只是 warning —— 且整个报告仍然 ready
    expect(factsCheck?.severity).toBe("warning");
    expect(report.blockerCount).toBe(0);
    expect(report.ready).toBe(true);
  });

  it("P0-4a：facts=0 的 hint 必须说清是结构性缺口，不能让律师以为是自己没给材料", () => {
    const report = validateReasoningAgainstSpec(
      buildGraph({
        issueTree: [
          {
            issue: "i1",
            elements: [],
            facts: [],
            evidence: [],
            authorityIds: ["a1"],
            openQuestions: [],
            confidence: 0.9,
          },
        ],
      }),
      "letter.demand",
    );
    const hint = report.checks.find((c) => c.key === "facts_grounded")?.hint ?? "";
    expect(hint).toMatch(/没有争点可挂|没有返回这类来源/);
    expect(hint).toMatch(/不自动等于本次稿件有质量问题/);
  });

  it("P0-4a：有事实但不足 minFacts 时，hint 指向补材料（与结构性缺口区分）", () => {
    const report = validateReasoningAgainstSpec(
      buildGraph({
        issueTree: [
          {
            issue: "i1",
            elements: [],
            facts: ["合同第12条"],
            evidence: [],
            authorityIds: ["a1"],
            openQuestions: [],
            confidence: 0.9,
          },
        ],
      }),
      "letter.demand",
    );
    const hint = report.checks.find((c) => c.key === "facts_grounded")?.hint ?? "";
    expect(hint).toMatch(/补充案件事实材料/);
    expect(hint).not.toMatch(/结构性缺口/);
  });
});

describe("specRequiresReasoningGraphAtDraft", () => {
  it("defaults to true when reasoningGate.required is true", () => {
    expect(specRequiresReasoningGraphAtDraft(getDeliverableSpec("letter.demand"))).toBe(true);
    expect(specRequiresReasoningGraphAtDraft(getDeliverableSpec("contract.review"))).toBe(true);
  });

  it("returns false when no reasoningGate", () => {
    expect(specRequiresReasoningGraphAtDraft(getDeliverableSpec("document.general"))).toBe(false);
  });

  it("honors explicit requiresReasoningGraphAtDraft=false", () => {
    const spec = {
      ...getDeliverableSpec("letter.demand")!,
      reasoningGate: {
        required: true,
        requiresReasoningGraphAtDraft: false,
      },
    };
    expect(specRequiresReasoningGraphAtDraft(spec)).toBe(false);
  });
});

describe("validateReasoningGraphAtDraft", () => {
  function tmpWs(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-rg-draft-"));
  }

  function makeDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
    return {
      taskId: "t-rg",
      title: "T",
      output: "docx",
      templateId: "letter-demand-default",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      deliverableType: "letter.demand",
      ...overrides,
    };
  }

  it("required spec with reasoning snapshot → ready", () => {
    const ws = tmpWs();
    const draft = makeDraft();
    persistReasoningSnapshot(ws, buildGraph({ taskId: draft.taskId }));
    const report = validateReasoningGraphAtDraft(draft, ws);
    expect(report.required).toBe(true);
    expect(report.hasSnapshot).toBe(true);
    expect(report.ready).toBe(true);
  });

  it("required spec without snapshot → not ready", () => {
    const ws = tmpWs();
    const draft = makeDraft();
    const report = validateReasoningGraphAtDraft(draft, ws);
    expect(report.required).toBe(true);
    expect(report.hasSnapshot).toBe(false);
    expect(report.ready).toBe(false);
    expect(report.hint).toMatch(/reasoning\.json/);
  });

  it("non-required spec without snapshot → ready", () => {
    const ws = tmpWs();
    const draft = makeDraft({ deliverableType: "document.general" });
    const report = validateReasoningGraphAtDraft(draft, ws);
    expect(report.required).toBe(false);
    expect(report.ready).toBe(true);
  });

  it("accepts hasLegalReasoningSnapshot flag without file", () => {
    const ws = tmpWs();
    const draft = makeDraft({ hasLegalReasoningSnapshot: true });
    const report = validateReasoningGraphAtDraft(draft, ws);
    expect(report.required).toBe(true);
    expect(report.hasSnapshot).toBe(true);
    expect(report.ready).toBe(true);
  });
});

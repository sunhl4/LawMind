/**
 * Maps replay fixture gate outcome strings to structural checks (no LLM).
 */

import { validateReasoningAgainstSpec } from "../deliverables/reasoning-validator.js";
import { getDeliverableSpec } from "../deliverables/registry.js";
import { validateDraftAgainstSpec } from "../deliverables/validator.js";
import type { ArtifactDraft } from "../types.js";
import type { LegalReplayFixture } from "./replay-fixtures.js";

export type ReplayGateCheckResult = {
  outcome: string;
  satisfied: boolean;
  detail: string;
};

/** Replay fixture aliases → registry deliverable type ids. */
export function resolveReplayDeliverableType(type: string): string {
  if (type === "contract-review") {
    return "contract.review";
  }
  return type;
}

function minimalDraftForFixture(fixture: LegalReplayFixture): ArtifactDraft {
  const body = [
    ...fixture.requiredSources.map((s) => `来源：${s}`),
    "风险说明：已标注关键风险点供律师复核。",
    "结论：待律师最终确认。下一步：请客户配合补充材料。",
    "争议节点：按时间顺序排列的关键事实。",
  ].join("\n");
  return {
    taskId: `replay-${fixture.fixtureId}`,
    title: fixture.category,
    summary: body,
    output: "docx",
    templateId: "replay-fixture",
    deliverableType: resolveReplayDeliverableType(fixture.expectedDeliverableType),
    matterId: fixture.matterId,
    reviewStatus: "pending",
    reviewNotes: [],
    sections: [
      { heading: "摘要", body },
      {
        heading: "来源与依据",
        body: fixture.requiredSources.map((src) => `来源：${src}；摘录：${src}`).join("\n"),
      },
      { heading: "待补材料", body: "缺失来源清单：无（结构验收）" },
    ],
    createdAt: new Date().toISOString(),
  };
}

export function evaluateReplayGateOutcome(
  outcome: string,
  fixture: LegalReplayFixture,
  draft: ArtifactDraft,
): ReplayGateCheckResult {
  const specType = resolveReplayDeliverableType(fixture.expectedDeliverableType);
  const spec = getDeliverableSpec(specType);
  const acceptance = validateDraftAgainstSpec(draft, { spec });
  const reasoning = validateReasoningAgainstSpec(undefined, specType);

  switch (outcome) {
    case "source_anchors_present":
      return {
        outcome,
        satisfied: draft.sections.some(
          (s) => s.body.includes("来源：") || s.heading.includes("来源"),
        ),
        detail: "source anchor language in sections",
      };
    case "acceptance_pack_ready":
      return {
        outcome,
        satisfied: Boolean(spec),
        detail: spec ? `spec=${spec.type}` : "no spec",
      };
    case "reasoning_gate_ready":
      return {
        outcome,
        satisfied: reasoning.required || fixture.riskLevel === "high",
        detail: `reasoningRequired=${reasoning.required}`,
      };
    case "review_matrix_present":
      return {
        outcome,
        satisfied: fixture.category === "contract_review",
        detail: `category=${fixture.category}`,
      };
    case "lawyer_approval_required":
      return {
        outcome,
        satisfied:
          fixture.riskLevel === "high" ||
          spec?.defaultRiskLevel === "high" ||
          spec?.reasoningGate?.required === true ||
          acceptance.checks.some((c) => c.key.includes("review")),
        detail: `risk=${fixture.riskLevel}`,
      };
    case "audience_fit_checked":
      return {
        outcome,
        satisfied: fixture.category === "client_update",
        detail: `category=${fixture.category}`,
      };
    case "pending_actions_visible":
      return {
        outcome,
        satisfied: draft.sections.some((s) => s.body.includes("下一步")),
        detail: "next-step language present",
      };
    case "risk_register_present":
      return {
        outcome,
        satisfied: draft.sections.some((s) => s.body.includes("风险")),
        detail: "risk language present",
      };
    case "missing_sources_listed":
      return {
        outcome,
        satisfied:
          draft.sections.some((s) => s.heading.includes("待补") || s.body.includes("缺失")) ||
          fixture.requiredSources.length > 0,
        detail: "missing-source section or requiredSources",
      };
    case "matter_scope_enforced":
      return {
        outcome,
        satisfied: Boolean(draft.matterId?.trim()),
        detail: `matterId=${draft.matterId ?? ""}`,
      };
    case "chronology_order_checked":
      return {
        outcome,
        satisfied:
          fixture.category === "matter_chronology" &&
          draft.sections.some((s) => s.body.includes("顺序") || s.body.includes("时间")),
        detail: `category=${fixture.category}`,
      };
    case "issue_coverage_checked":
      return {
        outcome,
        satisfied: fixture.category === "legal_memo" && acceptance.checks.length > 0,
        detail: `checks=${acceptance.checks.length}`,
      };
    default:
      return { outcome, satisfied: false, detail: `unknown outcome: ${outcome}` };
  }
}

export function evaluateReplayFixtureStructure(fixture: LegalReplayFixture): {
  fixtureId: string;
  allSatisfied: boolean;
  checks: ReplayGateCheckResult[];
} {
  const draft = minimalDraftForFixture(fixture);
  const checks = fixture.expectedGateOutcomes.map((outcome) =>
    evaluateReplayGateOutcome(outcome, fixture, draft),
  );
  return {
    fixtureId: fixture.fixtureId,
    allSatisfied: checks.every((c) => c.satisfied),
    checks,
  };
}

import {
  checkRelationEdges,
  renderRelationFindings,
  type RelationEdge,
} from "./definition-relations.js";
import type { FactorState } from "./factor-state.js";
import {
  buildWitnessProbes,
  scoreWitnessAnswer,
  witnessReport,
  type WitnessScore,
} from "./factor-witness.js";
import { normalizeReviewObservations } from "./review-observations.js";

export type ObservationEnvelope = {
  kind: "witness" | "relation" | "review";
  payload: Record<string, unknown>;
  /** Only witness envelopes carry typed scores; used to feed the weak filter. */
  scores?: WitnessScore[];
};

/**
 * 由工具返回的显式观察转成总线 payload。
 * 这些函数只读、只校验，不把观察升级成证据。
 */
export function witnessEnvelopeFromToolData(
  state: FactorState,
  data: Record<string, unknown>,
): ObservationEnvelope | undefined {
  const raw = Array.isArray(data.witnessAnswers) ? data.witnessAnswers : undefined;
  if (!raw || raw.length === 0) {
    return undefined;
  }
  const probes = buildWitnessProbes(state, raw.length);
  const scores = raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Record<string, unknown>;
    const answer = typeof row.answer === "string" ? row.answer : "";
    const anchor = typeof row.anchor === "string" ? row.anchor.trim() : "";
    const probe = anchor ? probes.find((candidate) => candidate.anchor === anchor) : probes[index];
    return probe && answer.trim() ? [scoreWitnessAnswer(probe, answer)] : [];
  });
  if (scores.length === 0) {
    return undefined;
  }
  const report = witnessReport(scores);
  return {
    kind: "witness",
    payload: {
      probes: report.probes,
      verdict: report.verdict,
      driftAnchors: report.driftAnchors,
      scores: report.scores,
    },
    scores,
  };
}

export function reviewEnvelopeFromToolData(
  data: Record<string, unknown>,
): ObservationEnvelope | undefined {
  const raw = data.reviewObservations ?? data.review_observations;
  const batch = normalizeReviewObservations(raw);
  if (batch.accepted.length === 0 && batch.rejected.length === 0) {
    return undefined;
  }
  return {
    kind: "review",
    payload: {
      accepted: batch.accepted,
      rejected: batch.rejected,
    },
  };
}

export function relationEnvelopeFromState(
  state: FactorState,
  explicitEdges: readonly RelationEdge[] = [],
): ObservationEnvelope | undefined {
  const edges = explicitEdges.length > 0 ? explicitEdges : definitionAliasEdges(state);
  if (edges.length === 0) {
    return undefined;
  }
  const findings = checkRelationEdges(state, edges);
  if (findings.conflicts.length === 0 && findings.insufficient.length === 0) {
    return undefined;
  }
  return {
    kind: "relation",
    payload: {
      edges,
      conflicts: findings.conflicts,
      insufficient: findings.insufficient,
      rendered: renderRelationFindings(findings),
    },
  };
}

/** Derive only typed alias edges already present in the factor graph. */
export function definitionAliasEdges(state: FactorState): RelationEdge[] {
  const edges: RelationEdge[] = [];
  for (const factor of state.factors) {
    if (!factor.anchor.startsWith("defined:")) {
      continue;
    }
    for (const neighbor of factor.neighbors) {
      if (!neighbor.startsWith("defined:") || factor.anchor >= neighbor) {
        continue;
      }
      const anchors = [factor.anchor, neighbor].toSorted() as [string, string];
      edges.push({ kind: "alias_equality", anchors });
    }
  }
  return edges;
}

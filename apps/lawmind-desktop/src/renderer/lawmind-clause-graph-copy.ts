import { DRAFT_CRITIC_PREFIX } from "../../../../src/lawmind/reasoning/draft-critic.ts";
import { clauseGraphHeadline, type ClauseGraph } from "../../../../src/lawmind/reasoning/clause-graph.ts";

export function criticNotesFromReview(notes: string[] | undefined): string[] {
  return (notes ?? []).filter((note) => note.startsWith(DRAFT_CRITIC_PREFIX));
}

export function clauseGraphSummaryLine(graph: ClauseGraph): string {
  return clauseGraphHeadline(graph);
}

export function clauseHasFlags(clause: ClauseGraph["clauses"][number]): boolean {
  return clause.risks.length > 0 || clause.missing.length > 0 || clause.criticNotes.length > 0;
}

export function shouldDefaultCollapseClause(clause: ClauseGraph["clauses"][number]): boolean {
  return !clauseHasFlags(clause);
}

export function sortClausesForReview(graph: ClauseGraph): ClauseGraph["clauses"] {
  const flagged: ClauseGraph["clauses"] = [];
  const clean: ClauseGraph["clauses"] = [];
  for (const clause of graph.clauses) {
    if (clauseHasFlags(clause)) {
      flagged.push(clause);
    } else {
      clean.push(clause);
    }
  }
  return [...flagged, ...clean];
}

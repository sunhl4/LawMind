import { clauseGraphHeadline, type ClauseGraph } from "../../../../src/lawmind/reasoning/clause-graph.ts";

const DRAFT_CRITIC_PREFIX = "复核：";

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

export function clauseGraphHasFlags(graph: ClauseGraph): boolean {
  return graph.clauses.some((clause) => clauseHasFlags(clause));
}

/** 合同/函件始终可看；其它文稿只在有风险、缺项或复核意见时出现。 */
export function shouldShowClauseGraph(
  graph: ClauseGraph | null | undefined,
  deliverableType?: string | null,
): boolean {
  if (!graph || graph.clauses.length === 0) {
    return false;
  }
  const dt = (deliverableType ?? "").trim().toLowerCase();
  if (dt.startsWith("contract.") || dt.startsWith("letter.")) {
    return true;
  }
  return clauseGraphHasFlags(graph);
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

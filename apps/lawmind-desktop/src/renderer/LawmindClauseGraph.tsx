import type { ReactNode } from "react";
import type { ClauseGraph } from "../../../../src/lawmind/reasoning/clause-graph.ts";
import {
  clauseGraphHasFlags,
  clauseGraphSummaryLine,
  clauseHasFlags,
  shouldDefaultCollapseClause,
  shouldShowClauseGraph,
  sortClausesForReview,
} from "./lawmind-clause-graph-copy";

type Props = {
  graph: ClauseGraph | null | undefined;
  deliverableType?: string | null;
};

export function LawmindClauseGraph(props: Props): ReactNode {
  const { graph, deliverableType } = props;
  if (!shouldShowClauseGraph(graph, deliverableType) || !graph) {
    return null;
  }
  const ordered = sortClausesForReview(graph);
  const flagged = clauseGraphHasFlags(graph);
  return (
    <div
      id="lm-review-clause-graph"
      className="lm-clause-graph"
      role="region"
      aria-label="条款图与复核"
      data-testid="lm-review-clause-graph"
    >
      <details className="lm-clause-graph-wrap" open={flagged}>
        <summary className="lm-clause-graph-headline">
          <strong>条款图</strong>
          <span className="lm-meta">{clauseGraphSummaryLine(graph)}</span>
        </summary>
      <p className="lm-meta lm-clause-graph-hint">
        有风险或缺项的条款排在前面；干净条款默认收起。复核只加意见，不改正文。
      </p>
      <ol className="lm-clause-graph-list">
        {ordered.map((clause) => {
          const clauseFlagged = clauseHasFlags(clause);
          return (
            <li
              key={clause.id}
              className={clauseFlagged ? "lm-clause-graph-item flagged" : "lm-clause-graph-item"}
            >
              <details open={!shouldDefaultCollapseClause(clause)}>
                <summary className="lm-clause-graph-heading">{clause.heading}</summary>
                {clause.risks.length > 0 ? (
                  <div className="lm-meta">风险：{clause.risks.join("、")}</div>
                ) : null}
                {clause.missing.length > 0 ? (
                  <div className="lm-meta">缺项：{clause.missing.join("、")}</div>
                ) : null}
                {clause.criticNotes.length > 0 ? (
                  <ul className="lm-clause-graph-notes">
                    {clause.criticNotes.map((note) => (
                      <li key={note}>复核：{note}</li>
                    ))}
                  </ul>
                ) : null}
                {!clauseFlagged ? <div className="lm-meta">未见规则缺项</div> : null}
              </details>
            </li>
          );
        })}
      </ol>
      </details>
    </div>
  );
}

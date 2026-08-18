import type { ReactNode } from "react";
import type { ClauseGraph } from "../../../../src/lawmind/reasoning/clause-graph.ts";
import { clauseGraphSummaryLine, clauseHasFlags } from "./lawmind-clause-graph-copy";

type Props = {
  graph: ClauseGraph | null | undefined;
};

export function LawmindClauseGraph(props: Props): ReactNode {
  const { graph } = props;
  if (!graph || graph.clauses.length === 0) {
    return null;
  }
  return (
    <div
      id="lm-review-clause-graph"
      className="lm-clause-graph"
      role="region"
      aria-label="条款图与复核"
    >
      <div className="lm-clause-graph-headline">
        <strong>条款图</strong>
        <span className="lm-meta">{clauseGraphSummaryLine(graph)}</span>
      </div>
      <p className="lm-meta lm-clause-graph-hint">逐条标风险与缺项；复核只加意见，不改正文。</p>
      <ol className="lm-clause-graph-list">
        {graph.clauses.map((clause) => (
          <li key={clause.id} className={clauseHasFlags(clause) ? "lm-clause-graph-item flagged" : "lm-clause-graph-item"}>
            <div className="lm-clause-graph-heading">{clause.heading}</div>
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
          </li>
        ))}
      </ol>
    </div>
  );
}

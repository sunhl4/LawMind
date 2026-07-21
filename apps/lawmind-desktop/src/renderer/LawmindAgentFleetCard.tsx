import type { ReactNode } from "react";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { agentRunStatusLabel } from "./lawmind-agent-fleet-api";

type Props = {
  run: AgentRunSummary;
  selected: boolean;
  onSelect: (run: AgentRunSummary) => void;
  /** Filmstrip: status + title only. */
  compact?: boolean;
};

function needsAttention(run: AgentRunSummary): boolean {
  return (
    run.status === "awaiting_clarification" ||
    run.status === "awaiting_approval" ||
    run.status === "awaiting_review"
  );
}

export function LawmindAgentFleetCard({ run, selected, onSelect, compact }: Props): ReactNode {
  const attention = needsAttention(run);

  return (
    <button
      type="button"
      className={`lm-agent-fleet-card${selected ? " lm-agent-fleet-card-selected" : ""}${attention ? " lm-agent-fleet-card-attention" : ""}${compact ? " lm-agent-fleet-card-compact" : ""}`}
      data-testid={`lm-agent-fleet-card-${run.kind}`}
      onClick={() => onSelect(run)}
    >
      <span className={`lm-agent-fleet-status lm-agent-fleet-status-${run.status}`}>
        {agentRunStatusLabel(run.status)}
      </span>
      <strong className="lm-agent-fleet-card-title">{run.title}</strong>
    </button>
  );
}

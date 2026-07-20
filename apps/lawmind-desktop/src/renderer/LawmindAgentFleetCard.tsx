import type { ReactNode } from "react";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { agentRunKindLabel, agentRunStatusLabel } from "./lawmind-agent-fleet-api";

type Props = {
  run: AgentRunSummary;
  selected: boolean;
  onSelect: (run: AgentRunSummary) => void;
};

function nextStepHint(run: AgentRunSummary): string | null {
  switch (run.status) {
    case "awaiting_clarification":
      return "下一步：补充信息后继续";
    case "awaiting_approval":
      return "下一步：批准或驳回";
    case "awaiting_review":
      return "下一步：进入文书台签批";
    case "queued":
    case "scheduled":
      return "下一步：等待开始执行";
    case "running":
      return "进行中：可打开对话查看过程";
    case "failed":
      return "下一步：打开对话查看失败原因";
    case "completed":
      return run.taskId ? "可进入文书台查看交付物" : null;
    case "cancelled":
      return null;
  }
}

export function LawmindAgentFleetCard({ run, selected, onSelect }: Props): ReactNode {
  const progressPct =
    run.progress && run.progress.total > 0
      ? Math.round((run.progress.completed / run.progress.total) * 100)
      : null;
  const nextStep = nextStepHint(run);

  return (
    <button
      type="button"
      className={`lm-agent-fleet-card${selected ? " lm-agent-fleet-card-selected" : ""}`}
      data-testid={`lm-agent-fleet-card-${run.kind}`}
      onClick={() => onSelect(run)}
    >
      <div className="lm-agent-fleet-card-head">
        <span className={`lm-agent-fleet-kind lm-agent-fleet-kind-${run.kind}`}>
          {agentRunKindLabel(run.kind)}
        </span>
        <span className={`lm-agent-fleet-status lm-agent-fleet-status-${run.status}`}>
          {agentRunStatusLabel(run.status)}
        </span>
      </div>
      <strong className="lm-agent-fleet-card-title">{run.title}</strong>
      {run.subtitle ? <span className="lm-meta lm-agent-fleet-card-sub">{run.subtitle}</span> : null}
      {nextStep ? <span className="lm-meta lm-agent-fleet-card-next">{nextStep}</span> : null}
      <div className="lm-agent-fleet-card-meta">
        {run.assigneeLabel ? <span>{run.assigneeLabel}</span> : null}
        {run.matterId ? <span className="lm-agent-fleet-matter">{run.matterId}</span> : null}
      </div>
      {progressPct != null ? (
        <div className="lm-agent-fleet-progress" aria-label={`进度 ${progressPct}%`}>
          <div className="lm-agent-fleet-progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
      ) : null}
    </button>
  );
}

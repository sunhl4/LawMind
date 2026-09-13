import type { ReactNode } from "react";
import type { AgentTurnPlan } from "../../../../src/lawmind/agent/turn-plan-model.ts";
import { isTurnPlanComplete, turnPlanProgress } from "../../../../src/lawmind/agent/turn-plan-model.ts";

type Props = {
  plan: AgentTurnPlan;
};

function statusIcon(status: AgentTurnPlan["items"][number]["status"]): string {
  if (status === "completed") {
    return "✓";
  }
  if (status === "in_progress") {
    return "→";
  }
  return "○";
}

function statusLabel(status: AgentTurnPlan["items"][number]["status"]): string {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "in_progress") {
    return "进行中";
  }
  return "待办";
}

export function LawmindTurnPlanCard(props: Props): ReactNode {
  const { plan } = props;
  const { completed, total } = turnPlanProgress(plan);
  const done = isTurnPlanComplete(plan);
  return (
    <section
      className={`lm-turn-plan ${done ? "lm-turn-plan-complete" : ""}`}
      aria-label="本轮步骤"
      data-testid="lm-turn-plan"
    >
      <div className="lm-turn-plan-head">
        <div className="lm-turn-plan-title">本轮步骤</div>
        <div className="lm-turn-plan-progress">
          {done ? "已完成" : `${completed}/${total}`}
        </div>
      </div>
      {plan.explanation ? (
        <p className="lm-turn-plan-note">{plan.explanation}</p>
      ) : null}
      <ol className="lm-turn-plan-steps">
        {plan.items.map((item, index) => (
          <li
            key={`${index}-${item.step}`}
            className={`lm-turn-plan-step lm-turn-plan-step-${item.status}`}
            aria-current={item.status === "in_progress" ? "step" : undefined}
          >
            <span className="lm-turn-plan-step-icon" aria-hidden>
              {statusIcon(item.status)}
            </span>
            <span className="lm-turn-plan-step-label">{item.step}</span>
            <span className="lm-sr-only">{statusLabel(item.status)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

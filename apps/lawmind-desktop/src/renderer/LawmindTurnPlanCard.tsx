import { useEffect, useState, type ReactNode } from "react";
import type { AgentTurnPlan } from "../../../../src/lawmind/agent/turn-plan-model.ts";
import {
  formatTurnPlanExecuteText,
  isTurnPlanComplete,
  lawyerFacingMaterials,
  turnPlanProgress,
} from "../../../../src/lawmind/agent/turn-plan-model.ts";

type Props = {
  plan: AgentTurnPlan;
  /** Plan mode: lawyer can uncheck steps and edit step text before「开始执行」. */
  editable?: boolean;
  onLawyerEditPlan?: (planText: string) => void;
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

function labelsFromPlan(plan: AgentTurnPlan): string[] {
  return plan.items.map((item) => item.step);
}

export function LawmindTurnPlanCard(props: Props): ReactNode {
  const { plan, editable = false, onLawyerEditPlan } = props;
  const { completed, total } = turnPlanProgress(plan);
  const done = isTurnPlanComplete(plan);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [labels, setLabels] = useState<string[]>(() => labelsFromPlan(plan));

  useEffect(() => {
    setSkipped(new Set());
    setLabels(labelsFromPlan(plan));
  }, [plan.updatedAt]);

  const emit = (nextSkipped: Set<number>, nextLabels: string[]) => {
    onLawyerEditPlan?.(formatTurnPlanExecuteText(plan, nextSkipped, nextLabels));
  };

  const toggleSkip = (index: number) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else if (next.size < plan.items.length - 1) {
        next.add(index);
      }
      emit(next, labels);
      return next;
    });
  };

  const editLabel = (index: number, value: string) => {
    setLabels((prev) => {
      const next = [...prev];
      next[index] = value;
      emit(skipped, next);
      return next;
    });
  };

  return (
    <section
      className={`lm-turn-plan ${done ? "lm-turn-plan-complete" : ""}`}
      aria-label={editable ? "计划模式步骤" : "本轮步骤"}
      data-testid="lm-turn-plan"
      data-editable={editable ? "true" : undefined}
    >
      <div className="lm-turn-plan-head">
        <div className="lm-turn-plan-title">{editable ? "计划（可改）" : "本轮步骤"}</div>
        <div className="lm-turn-plan-progress">
          {done ? "已完成" : `${completed}/${total}`}
        </div>
      </div>
      {plan.brief ? (
        <div className="lm-turn-plan-note" data-testid="lm-turn-plan-brief">
          <div>要做：{plan.brief.goal}</div>
          <div>不要做：{plan.brief.notGoal}</div>
          <div>材料：{lawyerFacingMaterials(plan.brief.materials)}</div>
          <div>完成标准：{plan.brief.done}</div>
        </div>
      ) : null}
      {plan.explanation ? <p className="lm-turn-plan-note">{plan.explanation}</p> : null}
      {editable ? (
        <p className="lm-turn-plan-note">
          可改步骤文字；取消勾选的步骤不会写入「开始执行」。点工具栏开始执行后才写稿。
        </p>
      ) : null}
      <ol className="lm-turn-plan-steps">
        {plan.items.map((item, index) => {
          const isSkipped = skipped.has(index);
          return (
            <li
              key={`${index}-${item.step}`}
              className={`lm-turn-plan-step lm-turn-plan-step-${item.status}${isSkipped ? " lm-turn-plan-step-skipped" : ""}`}
              aria-current={item.status === "in_progress" && !isSkipped ? "step" : undefined}
            >
              {editable ? (
                <label className="lm-turn-plan-skip">
                  <input
                    type="checkbox"
                    checked={!isSkipped}
                    data-testid={`lm-turn-plan-include-${index}`}
                    aria-label={`纳入执行：${labels[index] || item.step}`}
                    onChange={() => toggleSkip(index)}
                  />
                </label>
              ) : (
                <span className="lm-turn-plan-step-icon" aria-hidden>
                  {statusIcon(item.status)}
                </span>
              )}
              {editable ? (
                <input
                  className="lm-turn-plan-step-edit"
                  type="text"
                  value={labels[index] ?? item.step}
                  maxLength={80}
                  data-testid={`lm-turn-plan-edit-${index}`}
                  aria-label={`步骤 ${index + 1}`}
                  onChange={(e) => editLabel(index, e.target.value)}
                />
              ) : (
                <span className="lm-turn-plan-step-label">{item.step}</span>
              )}
              <span className="lm-sr-only">{isSkipped ? "已跳过" : statusLabel(item.status)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

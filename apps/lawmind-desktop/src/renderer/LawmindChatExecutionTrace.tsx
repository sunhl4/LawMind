import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { TaskExecutionState } from "../../../../src/lawmind/platform/contracts.ts";
import type { ChatLiveTrace } from "./lawmind-chat-trace-types.js";
import { summarizeLiveTrace } from "./lawmind-chat-trace.js";
import { formatExecutionStateLabel } from "./lawmind-execution-state-label.js";

type Props = {
  trace?: ChatLiveTrace;
  executionState?: TaskExecutionState;
  compact?: boolean;
  /** AgentActa-style vertical timeline (same steps, denser layout). */
  mode?: "steps" | "timeline";
};

function statusIcon(status: ChatLiveTrace["steps"][number]["status"]): string {
  if (status === "running") {return "◌";}
  if (status === "failed") {return "✕";}
  return "✓";
}

function stepStatusLabel(status: ChatLiveTrace["steps"][number]["status"]): string {
  if (status === "running") {return "进行中";}
  if (status === "failed") {return "失败";}
  return "已完成";
}

function LawmindChatExecutionTraceInner(props: Props): ReactNode {
  const { trace, executionState, compact = false, mode = "steps" } = props;
  const steps = trace?.steps ?? [];
  const showTrace = steps.length > 0 || trace?.active;
  const execLabel = formatExecutionStateLabel(executionState);
  const summary = summarizeLiveTrace(trace);
  const isActive = Boolean(trace?.active);
  const canCollapse = !isActive && steps.length > 0;
  const [expanded, setExpanded] = useState(isActive);
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      setExpanded(false);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  if (!showTrace && !execLabel) {
    return null;
  }

  const showMeta = execLabel && steps.length === 0 && !isActive;
  const showSteps = steps.length > 0 && (isActive || expanded || !canCollapse);
  const hasRoundSteps = steps.some((s) => s.kind === "round");
  const titleRound =
    trace?.currentRound && !hasRoundSteps ? ` · 第 ${trace.currentRound} 轮` : "";

  return (
    <div
      className={`lm-chat-trace ${compact ? "lm-chat-trace-compact" : ""} ${mode === "timeline" ? "lm-chat-trace-timeline" : ""} ${canCollapse && !expanded ? "lm-chat-trace-collapsed" : ""} ${isActive ? "lm-chat-trace-active" : ""}`}
      aria-live="off"
    >
      <div className="lm-chat-trace-head">
        <div className="lm-chat-trace-title">
          {isActive ? "思考中…" : summary ? `已完成 · ${summary}` : "过程"}
          {isActive ? titleRound : null}
        </div>
        {canCollapse ? (
          <button
            type="button"
            className="lm-chat-trace-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "展开"}
          </button>
        ) : null}
      </div>

      {canCollapse && !expanded && summary ? (
        <div className="lm-chat-trace-summary">{summary}</div>
      ) : null}

      {showMeta ? (
        <div className="lm-chat-trace-meta">
          <span className="lm-pill lm-pill-neutral">{execLabel}</span>
        </div>
      ) : null}

      {showSteps ? (
        <ol className="lm-chat-trace-steps">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`lm-chat-trace-step lm-chat-trace-step-${step.status} lm-chat-trace-step-${step.kind}`}
            >
              <span className="lm-chat-trace-step-icon" aria-hidden>
                {statusIcon(step.status)}
              </span>
              <span className="lm-chat-trace-step-label">{step.label}</span>
              <span className="lm-sr-only">{stepStatusLabel(step.status)}</span>
              {step.detail ? (
                <span className="lm-chat-trace-step-detail">{step.detail}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : isActive && steps.length === 0 ? (
        <div className="lm-chat-trace-wait">等待模型与工具响应…</div>
      ) : !canCollapse && !showSteps && summary ? (
        <div className="lm-chat-trace-summary">{summary}</div>
      ) : null}
    </div>
  );
}

export const LawmindChatExecutionTrace = memo(LawmindChatExecutionTraceInner);

/**
 * 在办 · 案件步骤「等待超时」详情。
 *
 * 只呈现律师作决定需要的事实：在等什么、什么时候到期、什么时候升级。
 * 判定仍由 MatterRun 的状态机与落盘层负责；这里不推断后续步骤会不会执行。
 */
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { MATTER_RUN_WAIT_REASON_LABELS_ZH } from "../../../../src/lawmind/platform/matter-run-wait.ts";

export type LawmindMatterRunWaitDetailProps = {
  wait: NonNullable<AgentRunSummary["matterRunWait"]> | null;
  /** 步骤名；缺省时退回运行标题。 */
  title: string;
  busy?: boolean;
  error?: string | null;
  /** 再等多少天；与落盘层默认值保持一致，仅用于按钮文案。 */
  extendDays?: number;
  onExtend: () => void;
  onSkip: () => void;
};

const STEP_STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "进行中",
  waiting: "等待中",
  done: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

function formatTime(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "";
  }
  return new Date(ms).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LawmindMatterRunWaitDetail({
  wait,
  title,
  busy = false,
  error = null,
  extendDays = 3,
  onExtend,
  onSkip,
}: LawmindMatterRunWaitDetailProps) {
  if (!wait) {
    return (
      <div className="lm-agents-wb-block" data-testid="lm-matter-wait-hint">
        <p>这一步在等外部事件。到期没等到，才会进到你这里。</p>
      </div>
    );
  }
  const reason = MATTER_RUN_WAIT_REASON_LABELS_ZH[wait.reason];
  const due = formatTime(wait.dueAt);
  const escalated = formatTime(wait.escalatedAt);
  return (
    <div className="lm-agents-wb-block" data-testid="lm-matter-wait-detail">
      <div className="lm-matter-wait-head">
        <p className="lm-matter-wait-kicker">{reason}</p>
        <h3 className="lm-matter-wait-title">{wait.stepTitle?.trim() || title}</h3>
      </div>
      <dl className="lm-matter-wait-facts">
        {due ? (
          <>
            <dt>原定到期</dt>
            <dd>{due}</dd>
          </>
        ) : null}
        {escalated ? (
          <>
            <dt>升级时间</dt>
            <dd>{escalated}</dd>
          </>
        ) : null}
      </dl>
      {wait.steps && wait.steps.length > 0 ? (
        <ol className="lm-matter-wait-steps" data-testid="lm-matter-wait-steps">
          {wait.steps.map((step) => (
            <li
              className="lm-matter-wait-step"
              key={step.stepId}
              data-status={step.status}
              data-testid={`lm-matter-wait-step-${step.stepId}`}
            >
              <span className="lm-matter-wait-step-title">{step.title?.trim() || step.stepId}</span>
              <span className="lm-matter-wait-step-status">{STEP_STATUS_LABELS[step.status] ?? step.status}</span>
              {step.attempts > 0 ? (
                <span className="lm-matter-wait-step-attempts">第 {step.attempts} 次</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="lm-meta lm-matter-wait-why">
        这一步在等外部事件（来件、邮件线程或新材料归档）。事件到了会自动往下走；到期还没到，才会停在这里等你决定。
      </p>
      <div className="lm-matter-wait-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-matter-wait-extend"
          disabled={busy}
          onClick={onExtend}
        >
          再等 {extendDays} 天
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          data-testid="lm-matter-wait-skip"
          disabled={busy}
          onClick={onSkip}
        >
          不再等这一步
        </button>
      </div>
      <p className="lm-meta lm-matter-wait-note">
        再等会把到期时间往后推，事件提前到达照样会唤醒；不再等会跳过这一步，后续步骤照常继续。
      </p>
      {error ? (
        <p className="lm-callout lm-callout-danger" role="alert" data-testid="lm-matter-wait-error">
          <span className="lm-callout-body">{error}</span>
        </p>
      ) : null}
    </div>
  );
}

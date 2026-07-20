import type { ReactNode } from "react";
import type { LawMindRequiresAction } from "./lawmind-requires-action";

type Props = {
  action?: LawMindRequiresAction;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
};

function workflowArgsSummary(toolArgs?: Record<string, unknown>): string {
  if (!toolArgs) {
    return "";
  }
  const parts: string[] = [];
  if (typeof toolArgs.workflowId === "string" && toolArgs.workflowId.trim()) {
    parts.push(`工作流 ID：${toolArgs.workflowId.trim()}`);
  }
  const steps = toolArgs.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    const labels = steps
      .map((s) => {
        if (typeof s === "string") {
          return s.trim();
        }
        if (s && typeof s === "object" && typeof (s as { label?: string }).label === "string") {
          return (s as { label: string }).label.trim();
        }
        return "";
      })
      .filter(Boolean);
    if (labels.length > 0) {
      parts.push(`步骤：${labels.join(" → ")}`);
    } else {
      parts.push(`步骤数：${steps.length}`);
    }
  }
  if (typeof toolArgs.instruction === "string" && toolArgs.instruction.trim()) {
    const inst = toolArgs.instruction.trim();
    parts.push(inst.length > 100 ? `指令：${inst.slice(0, 100)}…` : `指令：${inst}`);
  }
  return parts.join("\n");
}

/** Chat bubble for execute_workflow tool approval (wired to chat/resume). */
export function LawmindMsgWorkflowApproval({
  action,
  busy = false,
  onApprove,
  onReject,
}: Props): ReactNode {
  const title = action?.title?.trim() || "工作流待确认";
  const detail =
    action?.summary?.trim() ||
    workflowArgsSummary(action?.toolArgs) ||
    "执行前请确认步骤与交付物类型。批准后将注入 __approved 并继续本轮。";

  return (
    <div className="lm-msg lm-msg-ai lm-msg-workflow-approval" data-testid="lm-msg-workflow-approval">
      <div className="lm-msg-workflow-approval-title">{title}</div>
      <p className="lm-meta" style={{ whiteSpace: "pre-wrap" }}>
        {detail}
      </p>
      {onApprove || onReject ? (
        <div className="lm-msg-actions" style={{ marginTop: 8 }}>
          {onApprove ? (
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-sm"
              disabled={busy}
              onClick={() => onApprove()}
            >
              允许一次
            </button>
          ) : null}
          {onReject ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={busy}
              onClick={() => onReject()}
            >
              拒绝
            </button>
          ) : null}
        </div>
      ) : (
        <p className="lm-meta">请在上方待办条中批准或拒绝该工作流工具。</p>
      )}
    </div>
  );
}

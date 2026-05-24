import type { ReactNode } from "react";

type Props = {
  title?: string;
  detail?: string;
};

/** Placeholder for multi-step workflow / plan approval messages. */
export function LawmindMsgWorkflowApproval({
  title = "工作流待确认",
  detail = "执行前请确认步骤与交付物类型。",
}: Props): ReactNode {
  return (
    <div className="lm-msg lm-msg-ai lm-msg-workflow-approval" data-testid="lm-msg-workflow-approval">
      <div className="lm-msg-workflow-approval-title">{title}</div>
      <p className="lm-meta">{detail}</p>
    </div>
  );
}

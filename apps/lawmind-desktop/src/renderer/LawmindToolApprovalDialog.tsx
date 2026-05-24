import type { ReactNode } from "react";
import type { LawMindRequiresAction } from "./lawmind-requires-action";
import { LAWMIND_ATTORNEY_DISCLAIMER_SHORT } from "./lawmind-attorney-disclaimer";
import {
  approvalTemplateTitle,
  resolveApprovalTemplate,
  type ApprovalTemplate,
} from "./lawmind-approval-template";

type Props = {
  open: boolean;
  action: LawMindRequiresAction | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
};

function templateBody(template: ApprovalTemplate, action: LawMindRequiresAction): ReactNode {
  const args =
    action.toolArgs && typeof action.toolArgs === "object"
      ? JSON.stringify(action.toolArgs, null, 2)
      : "";
  switch (template) {
    case "readonly":
      return <p className="lm-meta">只读访问工作区/案件材料，不会修改交付物。</p>;
    case "acceptance":
      return (
        <p className="lm-meta">
          渲染将受验收门禁约束；未通过 acceptance 的草稿可能被拒绝导出。
        </p>
      );
    case "workflow":
      return <p className="lm-meta">将启动多步工作流，可能产生后台任务与委派。</p>;
    case "network":
      return <p className="lm-meta">将通过策略允许的主机访问外网检索。</p>;
    case "diff":
      return (
        <pre className="lm-approval-dialog-args">{args || "（无参数预览）"}</pre>
      );
    default:
      return <p className="lm-meta">{action.summary}</p>;
  }
}

export function LawmindToolApprovalDialog({
  open,
  action,
  onClose,
  onApprove,
  onReject,
  busy,
}: Props): ReactNode {
  if (!open || !action) {
    return null;
  }
  const template = resolveApprovalTemplate(action.toolName ?? "");
  return (
    <div className="lm-approval-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="lm-approval-dialog"
        role="dialog"
        aria-labelledby="lm-approval-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="lm-approval-dialog-title">{approvalTemplateTitle(template)}</h3>
        <p className="lm-approval-dialog-tool">{action.toolName ?? action.title}</p>
        {templateBody(template, action)}
        <p className="lm-attorney-disclaimer lm-approval-dialog-disclaimer">
          {LAWMIND_ATTORNEY_DISCLAIMER_SHORT}
        </p>
        <div className="lm-approval-dialog-actions">
          <button type="button" className="lm-btn lm-btn-secondary" disabled={busy} onClick={onReject}>
            拒绝
          </button>
          <button type="button" className="lm-btn" disabled={busy} onClick={onApprove}>
            允许一次
          </button>
        </div>
      </div>
    </div>
  );
}

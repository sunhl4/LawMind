import React from "react";

export type LawmindWorkspacePaneRecoveryProps = {
  canUseFilesystemBridge: boolean;
  onShowChat: () => void;
  onShowEditor: () => void;
};

function LawmindWorkspacePaneRecoveryImpl({
  canUseFilesystemBridge,
  onShowChat,
  onShowEditor,
}: LawmindWorkspacePaneRecoveryProps) {
  return (
    <div className="lm-workspace-pane-recovery" role="status">
      <div className="lm-messages-empty">
        <div className="lm-messages-empty-icon">◇</div>
        <div className="lm-messages-empty-title">工作区面板已隐藏</div>
        <p className="lm-messages-empty-lead">
          对话区与编辑区当前都不可见。请恢复至少一个面板以继续工作。
        </p>
        <div className="lm-workspace-bootstrap-gate-actions">
          <button type="button" className="lm-btn" onClick={onShowChat}>
            显示对话区
          </button>
          {canUseFilesystemBridge ? (
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onShowEditor}>
              显示编辑区
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const LawmindWorkspacePaneRecovery = React.memo(LawmindWorkspacePaneRecoveryImpl);

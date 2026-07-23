import React from "react";

export type LawmindWorkspaceBootstrapGateProps = {
  error: string | null;
  onOpenApiWizard: () => void;
};

/**
 * Only surfaces when local service bootstrap fails.
 * Connecting / first-start wait is silent — no top strip or splash card.
 */
function LawmindWorkspaceBootstrapGateImpl({ error, onOpenApiWizard }: LawmindWorkspaceBootstrapGateProps) {
  if (!error) {
    return null;
  }

  const preloadHint = error.includes("Preload bridge") || error.includes("Electron window");

  return (
    <div className="lm-workspace-bootstrap-gate" role="alert">
      <div className="lm-workspace-bootstrap-gate-card">
        <h2 className="lm-workspace-bootstrap-gate-title">无法连接 LawMind 本地服务</h2>
        <p className="lm-callout-body lm-workspace-bootstrap-gate-lead">{error}</p>
        {preloadHint ? (
          <p className="lm-meta lm-workspace-bootstrap-gate-hint">
            请使用 Electron 桌面窗口（运行 <code>pnpm lawmind:desktop</code>
            ），不要在 Chrome/Safari 中直接打开开发地址。
          </p>
        ) : null}
        <div className="lm-workspace-bootstrap-gate-actions">
          <button type="button" className="lm-btn" onClick={() => window.location.reload()}>
            重新加载
          </button>
          {!preloadHint ? (
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onOpenApiWizard}>
              API 配置向导
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const LawmindWorkspaceBootstrapGate = React.memo(LawmindWorkspaceBootstrapGateImpl);

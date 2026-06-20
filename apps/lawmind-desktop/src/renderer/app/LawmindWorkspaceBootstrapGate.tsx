import React from "react";

export type LawmindWorkspaceBootstrapGateProps = {
  error: string | null;
  onOpenApiWizard: () => void;
};

function LawmindWorkspaceBootstrapGateImpl({ error, onOpenApiWizard }: LawmindWorkspaceBootstrapGateProps) {
  const preloadHint =
    error?.includes("Preload bridge") || error?.includes("Electron window");

  return (
    <div className="lm-workspace-bootstrap-gate" role="status" aria-live="polite">
      <div className="lm-workspace-bootstrap-gate-card">
        {error ? (
          <>
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
          </>
        ) : (
          <>
            <div className="lm-workspace-bootstrap-gate-spinner" aria-hidden />
            <h2 className="lm-workspace-bootstrap-gate-title">正在连接本地服务…</h2>
            <p className="lm-meta lm-workspace-bootstrap-gate-hint">
              首次启动可能需要数秒，请稍候。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export const LawmindWorkspaceBootstrapGate = React.memo(LawmindWorkspaceBootstrapGateImpl);

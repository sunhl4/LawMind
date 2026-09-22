import type { ReactNode } from "react";

/**
 * Vite on :5174 is the Electron renderer URL. Opening it in Chrome/Cursor
 * still paints LawMind chrome (工作台 tabs) with no cases — that is not the product.
 */
export function LawmindDesktopRequiredPage(): ReactNode {
  return (
    <div className="lm-workspace-bootstrap-gate" data-testid="lm-desktop-required" role="alert">
      <div className="lm-workspace-bootstrap-gate-card">
        <h1 className="lm-workspace-bootstrap-gate-title">这不是 LawMind 工作台</h1>
        <p className="lm-callout-body lm-workspace-bootstrap-gate-lead">
          当前是开发服务器页面，没有案件、对话和本地卷宗。请打开本机名为{" "}
          <strong>LawMind</strong> 的桌面窗口（Dock / ⌘Tab），不要用浏览器打开本地址。
        </p>
        <p className="lm-meta lm-workspace-bootstrap-gate-hint">
          开发：终端运行 <code>pnpm lawmind:desktop</code>，等弹出的 LawMind 窗口。正式使用请打开安装包
          LawMind.app。
        </p>
      </div>
    </div>
  );
}

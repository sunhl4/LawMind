import React from "react";
import { LawmindBrandMark } from "./LawmindBrandMark";
import {
  type LawmindAppUpdateState,
  getLawmindAppUpdateSnapshot,
  isLawmindAppUpdatePillVisible,
  lawmindAppUpdatePillLabel,
  runLawmindAppUpdateAction,
  subscribeLawmindAppUpdate,
} from "../lawmind-app-update";

export type LawmindSideAccountFooterProps = {
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  /** 测试注入：替代外部 store 快照。 */
  updateStateTest?: LawmindAppUpdateState | null;
};

function pillTooltip(state: LawmindAppUpdateState): string {
  const v = state.version ? ` ${state.version}` : "";
  switch (state.status) {
    case "downloading":
      return state.percent == null
        ? `新版${v}正在后台下载，点击查看进度`
        : `新版${v}正在后台下载（${state.percent}%）`;
    case "downloaded":
      return `新版${v}已就绪，点击重启并安装`;
    default:
      return `发现新版本${v}，点击开始下载`;
  }
}

function SidebarAccountFooterImpl({
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  updateStateTest,
}: LawmindSideAccountFooterProps) {
  // 主进程推送驱动（弹窗/多窗口各自订阅）；没有 lawmindDesktop 时保持静默。
  const storeState = React.useSyncExternalStore(
    subscribeLawmindAppUpdate,
    getLawmindAppUpdateSnapshot,
    getLawmindAppUpdateSnapshot,
  );
  const state = updateStateTest ?? storeState;
  const pillVisible = isLawmindAppUpdatePillVisible(state);

  return (
    <div className="lm-side-account-footer">
      <span className="lm-side-account-avatar" aria-hidden="true">
        <LawmindBrandMark size={20} />
      </span>
      <span className="lm-side-account-name" title="LawMind">
        LawMind
      </span>
      {pillVisible ? (
        <button
          type="button"
          className={`lm-side-update-pill${
            state.status === "downloaded" ? " lm-side-update-pill-ready" : ""
          }`}
          data-testid="lm-side-update-pill"
          title={pillTooltip(state)}
          aria-label={`应用更新：${pillTooltip(state)}`}
          onClick={() => void runLawmindAppUpdateAction()}
        >
          {lawmindAppUpdatePillLabel(state)}
        </button>
      ) : null}
      <span className="lm-side-account-spacer" aria-hidden="true" />
      <button
        type="button"
        className={`lm-gear-btn${settingsOpen ? " is-active" : ""}`}
        onClick={settingsOpen ? onCloseSettings : onOpenSettings}
        aria-label={settingsOpen ? "关闭设置" : "设置"}
        aria-pressed={settingsOpen}
        title={settingsOpen ? "关闭设置" : "设置"}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M6.5.75h3l.3 1.77a5.5 5.5 0 0 1 1.28.74l1.72-.58 1.5 2.6-1.42 1.19a5.6 5.6 0 0 1 0 1.06l1.42 1.19-1.5 2.6-1.72-.58a5.5 5.5 0 0 1-1.28.74l-.3 1.77h-3l-.3-1.77a5.5 5.5 0 0 1-1.28-.74l-1.72.58-1.5-2.6 1.42-1.19a5.6 5.6 0 0 1 0-1.06L1.7 5.28l1.5-2.6 1.72.58a5.5 5.5 0 0 1 1.28-.74L6.5.75Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

export const LawmindSideAccountFooter = React.memo(SidebarAccountFooterImpl);

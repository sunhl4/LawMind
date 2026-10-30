import type { LawmindAppHeaderProps } from "./LawmindAppHeader";
import type { LawmindAppOverlaysProps } from "./LawmindAppOverlays";
import type { LawmindAppSidebarProps } from "./LawmindAppSidebar";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import type { LawmindFileWorkbenchHostProps } from "./LawmindFileWorkbenchHost";
import type { LawmindAppRootDialogsProps } from "./LawmindAppRootDialogs";
import type { LawmindAppSettingsPanelProps } from "./LawmindAppSettingsPanel";
import { useState } from "react";
import { LawmindAppSidebar } from "./LawmindAppSidebar";
import { LawmindAppHeader } from "./LawmindAppHeader";
import { LawmindMainBodyContent } from "./LawmindMainBodyContent";
import { LawmindAppSettingsPanel } from "./LawmindAppSettingsPanel";
import { LawmindFileWorkbenchHost } from "./LawmindFileWorkbenchHost";
import { LawmindModalHost } from "./LawmindModalHost";
import { LawmindShellProviders } from "./LawmindShellContexts";
import type { LawmindMainView } from "../lawmind-main-view";

export type LawmindAppRootViewProps = {
  mainView: LawmindMainView;
  overlayProps: LawmindAppOverlaysProps;
  sidebarProps: LawmindAppSidebarProps;
  headerProps: LawmindAppHeaderProps;
  settingsPanelProps: LawmindAppSettingsPanelProps;
  mainBodyProps: LawmindMainBodyContentProps;
  fileWorkbenchHostProps: LawmindFileWorkbenchHostProps | null;
  dialogProps: LawmindAppRootDialogsProps;
  /** Set only in an aux pane window: a slim title bar replaces the full header. */
  paneWindow?: { title: string } | null;
  /** `false` = 这次收回没成功（主进程/窗口拒绝关闭），View 据此提示。 */
  onClosePaneWindow?: () => void | boolean | Promise<void | boolean>;
};

export function LawmindAppRootView({
  mainView,
  overlayProps,
  sidebarProps,
  headerProps,
  settingsPanelProps,
  mainBodyProps,
  fileWorkbenchHostProps,
  dialogProps,
  paneWindow = null,
  onClosePaneWindow,
}: LawmindAppRootViewProps) {
  const showSettings = settingsPanelProps.open;
  const paneWindowMode = Boolean(paneWindow);
  const [paneCloseFailed, setPaneCloseFailed] = useState(false);
  const providers = {
    navigation: {
      mainView,
      matterCockpitOpen: headerProps.matterCockpitOpen,
      settingsOpen: showSettings,
    },
    chatSession: {
      selectedAssistantId: headerProps.selectedAssistantId,
      activeChatSessionId: dialogProps.activeChatSessionId ?? undefined,
    },
  };

  return (
    <LawmindShellProviders navigation={providers.navigation} chatSession={providers.chatSession}>
      <div
        className={`lm-shell${mainView === "review" ? " lm-shell-review" : ""}${paneWindowMode ? " lm-shell-pane-window" : ""}`}
      >
        <a href="#main-content" className="lm-skip-nav">
          跳到主内容
        </a>
        <LawmindModalHost overlayProps={overlayProps} dialogProps={dialogProps} />
        {showSettings ? null : <LawmindAppSidebar {...sidebarProps} />}
        <main
          id="main-content"
          className={`lm-main${mainView === "review" ? " lm-main-review" : ""}${showSettings ? " lm-main-settings" : ""}${paneWindowMode ? " lm-main-pane-window" : ""}`}
        >
          {paneWindow ? (
            <div className="lm-pane-window-bar" data-testid="lm-pane-window-bar">
              <span className="lm-pane-window-title">{paneWindow.title}</span>
              <span className="lm-pane-window-hint">独立窗口</span>
              <span className="lm-header-spacer" aria-hidden />
              {paneCloseFailed ? (
                <span className="lm-pane-window-close-error" role="status">
                  没收回去，请直接关闭这个窗口
                </span>
              ) : null}
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                title="关闭独立窗口，回到主窗口"
                onClick={() => {
                  setPaneCloseFailed(false);
                  const finish = (closed: void | boolean) => {
                    if (closed === false) {
                      setPaneCloseFailed(true);
                    }
                  };
                  if (!onClosePaneWindow) {
                    window.close();
                    return;
                  }
                  let result: void | boolean | Promise<void | boolean>;
                  try {
                    result = onClosePaneWindow();
                  } catch {
                    setPaneCloseFailed(true);
                    return;
                  }
                  if (result && typeof (result as Promise<void | boolean>).then === "function") {
                    (result as Promise<void | boolean>).then(finish).catch(() => {
                      setPaneCloseFailed(true);
                    });
                    return;
                  }
                  finish(result as void | boolean);
                }}
              >
                收回主窗口
              </button>
            </div>
          ) : (
            <LawmindAppHeader {...headerProps} />
          )}
          <div className="lm-main-body">
            {showSettings ? (
              <LawmindAppSettingsPanel {...settingsPanelProps} />
            ) : (
              <LawmindMainBodyContent {...mainBodyProps} />
            )}
          </div>
        </main>
        {fileWorkbenchHostProps ? <LawmindFileWorkbenchHost {...fileWorkbenchHostProps} /> : null}
      </div>
    </LawmindShellProviders>
  );
}

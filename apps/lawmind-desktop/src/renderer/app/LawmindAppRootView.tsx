import type { LawmindAppHeaderProps } from "./LawmindAppHeader";
import type { LawmindAppOverlaysProps } from "./LawmindAppOverlays";
import type { LawmindAppSidebarProps } from "./LawmindAppSidebar";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import type { LawmindFileWorkbenchHostProps } from "./LawmindFileWorkbenchHost";
import type { LawmindAppRootDialogsProps } from "./LawmindAppRootDialogs";
import type { LawmindAppSettingsPanelProps } from "./LawmindAppSettingsPanel";
import { LawmindAppSidebar } from "./LawmindAppSidebar";
import { LawmindAppHeader } from "./LawmindAppHeader";
import { LawmindMainBodyContent } from "./LawmindMainBodyContent";
import { LawmindAppSettingsPanel } from "./LawmindAppSettingsPanel";
import { LawmindFileWorkbenchHost } from "./LawmindFileWorkbenchHost";
import { LawmindModalHost } from "./LawmindModalHost";
import { LawmindShellProviders } from "./LawmindShellContexts";

export type LawmindAppRootViewProps = {
  mainView: "workspace" | "collaboration" | "review";
  overlayProps: LawmindAppOverlaysProps;
  sidebarProps: LawmindAppSidebarProps;
  headerProps: LawmindAppHeaderProps;
  settingsPanelProps: LawmindAppSettingsPanelProps;
  mainBodyProps: LawmindMainBodyContentProps;
  fileWorkbenchHostProps: LawmindFileWorkbenchHostProps | null;
  dialogProps: LawmindAppRootDialogsProps;
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
}: LawmindAppRootViewProps) {
  const showSettings = settingsPanelProps.open;
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
      <div className={`lm-shell${mainView === "review" ? " lm-shell-review" : ""}`}>
        <a href="#main-content" className="lm-skip-nav">
          跳到主内容
        </a>
        <LawmindModalHost overlayProps={overlayProps} dialogProps={dialogProps} />
        <LawmindAppSidebar {...sidebarProps} />
        <main
          id="main-content"
          className={`lm-main${mainView === "review" ? " lm-main-review" : ""}${showSettings ? " lm-main-settings" : ""}`}
        >
          <LawmindAppHeader {...headerProps} />
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

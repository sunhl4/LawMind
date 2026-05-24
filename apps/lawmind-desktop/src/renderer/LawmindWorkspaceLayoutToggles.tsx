type Props = {
  sidebarCollapsed: boolean;
  wsShowEditor: boolean;
  wsShowChat: boolean;
  canUseFilesystemBridge: boolean;
  matterCockpitOpen: boolean;
  onToggleSidebar: () => void;
  onToggleEditor: () => void;
  onToggleChat: () => void;
};

export function LawmindWorkspaceLayoutToggles(props: Props) {
  const {
    sidebarCollapsed,
    wsShowEditor,
    wsShowChat,
    canUseFilesystemBridge,
    matterCockpitOpen,
    onToggleSidebar,
    onToggleEditor,
    onToggleChat,
  } = props;

  return (
    <div className="lm-panel-toggles" role="group" aria-label="工作区面板">
      <button
        type="button"
        className={`lm-panel-toggle ${sidebarCollapsed ? "lm-panel-toggle-off" : ""}`}
        title={sidebarCollapsed ? "显示侧栏" : "隐藏侧栏"}
        aria-label={sidebarCollapsed ? "显示侧栏" : "隐藏侧栏"}
        aria-pressed={!sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        <span className="lm-panel-toggle-icon" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="9" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        className={`lm-panel-toggle ${!wsShowEditor ? "lm-panel-toggle-off" : ""}`}
        aria-pressed={wsShowEditor}
        aria-label={wsShowEditor ? "隐藏编辑区" : "显示编辑区"}
        disabled={!canUseFilesystemBridge || matterCockpitOpen}
        title={
          matterCockpitOpen
            ? "案件工作台模式下请返回对话"
            : !canUseFilesystemBridge
              ? "请先连接工作区"
              : wsShowEditor
                ? "隐藏编辑区"
                : "显示编辑区"
        }
        onClick={onToggleEditor}
      >
        <span className="lm-panel-toggle-icon" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="2.5" y="2" width="11" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 5.5h6M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        className={`lm-panel-toggle ${!wsShowChat ? "lm-panel-toggle-off" : ""}`}
        aria-pressed={wsShowChat}
        aria-label={wsShowChat ? "隐藏对话区" : "显示对话区"}
        disabled={matterCockpitOpen}
        title={
          matterCockpitOpen
            ? "案件工作台模式下请返回对话"
            : wsShowChat
              ? "隐藏对话区"
              : "显示对话区"
        }
        onClick={onToggleChat}
      >
        <span className="lm-panel-toggle-icon" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
            <rect x="9" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M11 6.5 12.5 8 11 9.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    </div>
  );
}

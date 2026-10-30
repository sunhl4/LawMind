import React from "react";
import { LawmindMatterSidebarList } from "../LawmindMatterSidebarList";
import {
  LawmindSideChatSessions,
  type SideChatSessionRow,
} from "../LawmindSideChatSessions";
import type { MatterSidebarRow } from "../lawmind-records-desk-state";

import { LawmindSideExplorerSkeleton } from "./LawmindSideExplorerSkeleton";
import { LawmindSideAccountFooter } from "./LawmindSideAccountFooter";
import type { LawmindAppUpdateState } from "../lawmind-app-update";
import type { LawmindMainView } from "../lawmind-main-view";
import { LawmindBrandMark } from "./LawmindBrandMark";

export type LawmindAppSidebarProps = {
  showAppSidebar: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  showSidebarWorkbenchFiles: boolean;
  showExplorerSkeleton: boolean;
  onSidebarResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  settingsOpen: boolean;
  setFileExplorerHost: (el: HTMLDivElement | null) => void;
  /** 左栏底部「案件材料」portal；与 setFileExplorerHost（工作区）成对。 */
  setFileExplorerCasesHost: (el: HTMLDivElement | null) => void;
  actionSummaryTotal: number;
  matterSidebarRows: MatterSidebarRow[];
  selectedMatterKey: string | null;
  onSelectMatterKey: (matterId: string) => void;
  onSelectMatterForCockpit: (matterId: string) => void;
  matterCockpitOpen: boolean;
  mainView: LawmindMainView;
  /** Reserved for sidebar fetches that need the local API. */
  apiBase?: string;
  onOpenNeedsDecisionDesk: () => void;
  /** Workspace chat list in the left rail (Cursor-style). */
  chatSessions?: SideChatSessionRow[];
  activeChatSessionId?: string;
  chatSessionsLoading?: boolean;
  chatAssistantId?: string;
  /** null = 未归案。不传则列表不过滤。 */
  chatListScope?: string | null;
  onOpenChatScope?: (scope: string | null) => void;
  assistantDisplayById?: Record<string, string>;
  /** 当前本机文件夹的显示名，对话列表用来给未挂子文件夹的对话起标题。 */
  workspaceFolderLabel?: string | null;
  /** 本机文件夹全路径，悬停对话所属文件夹时显示。 */
  workspaceFolderPath?: string | null;
  /** 最上面「新建对话」实际放入的目录。 */
  newChatHomePath?: string | null;
  /** 在对话所属文件夹下新建。不传路径是工作区根目录。 */
  onNewChatInFolder?: (folderRel?: string) => void | Promise<void>;
  /** 用绝对路径新建一场工作区对话。不改已有对话。 */
  onCreateChatWorkspace?: (workDir: string) => void | Promise<void>;
  /** 切换器用全量案件，不受工作台搜索过滤。 */
  chatMatterRows?: MatterSidebarRow[];
  chatMattersReady?: boolean;
  onSelectChatSession?: (sessionId: string) => void | Promise<void>;
  onCreateNewChatSession?: () => void | Promise<void>;
  onRenameChatSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteChatSession?: (sessionId: string | readonly string[]) => void | Promise<void>;
  /** Opens create-matter dialog from the matter list (no-FS / empty list). */
  onCreateMatter?: () => void;
  /** 测试注入：底部账号行「更新」药丸的状态（默认走外部 store）。 */
  updateStateTest?: LawmindAppUpdateState | null;
};

function knownMatterIdsFromRows(
  rows: MatterSidebarRow[],
  ready: boolean,
): ReadonlySet<string> | null {
  if (!ready) {
    return null;
  }
  return new Set(rows.flatMap((row) => (row.matterId?.trim() ? [row.matterId.trim()] : [])));
}

function matterTitleByIdFromRows(rows: MatterSidebarRow[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const row of rows) {
    const id = row.matterId?.trim();
    if (id) {
      titles[id] = row.title;
    }
  }
  return titles;
}

function LawmindAppSidebarImpl({
  showAppSidebar,
  sidebarCollapsed,
  sidebarWidth,
  showSidebarWorkbenchFiles,
  showExplorerSkeleton,
  onSidebarResizePointerDown,
  onOpenSettings,
  onCloseSettings,
  settingsOpen,
  setFileExplorerHost,
  matterSidebarRows,
  selectedMatterKey,
  onSelectMatterKey,
  onSelectMatterForCockpit,
  matterCockpitOpen,
  mainView,
  apiBase,
  chatSessions,
  activeChatSessionId,
  chatSessionsLoading,
  chatAssistantId,
  assistantDisplayById,
  workspaceFolderLabel,
  workspaceFolderPath,
  newChatHomePath,
  onNewChatInFolder,
  onCreateChatWorkspace,
  chatMatterRows,
  chatMattersReady = false,
  onSelectChatSession,
  onCreateNewChatSession,
  onRenameChatSession,
  onDeleteChatSession,
  onCreateMatter,
  updateStateTest,
}: LawmindAppSidebarProps) {
  // Settings owns the full shell width; do not keep the workspace rail beside it.
  if (!showAppSidebar || settingsOpen) {
    return null;
  }

  // 对话 / 会议室 / 在办 / 工作台中栏：有材料树时不再叠案件列表。
  const showSideChat =
    (mainView === "workspace" || mainView === "desk" || mainView === "meeting" || mainView === "agents") &&
    Boolean(onSelectChatSession) &&
    Boolean(onCreateNewChatSession) &&
    Boolean(onRenameChatSession) &&
    Boolean(onDeleteChatSession);
  const showWorkspaceMatterList =
    (mainView === "workspace" || mainView === "desk" || mainView === "meeting" || mainView === "agents") &&
    !showSidebarWorkbenchFiles;
  const showMatterList = showWorkspaceMatterList && !showSideChat;
  const showWorkbenchExplorer =
    showSidebarWorkbenchFiles &&
    (mainView === "workspace" || mainView === "desk" || mainView === "meeting" || mainView === "agents");

  const matterListClassName = (() => {
    if (!showMatterList) {
      return undefined;
    }
    if (showSidebarWorkbenchFiles && !matterCockpitOpen) {
      return "lm-matter-sidebar-list--stacked";
    }
    if (!showSidebarWorkbenchFiles && !matterCockpitOpen) {
      return "lm-matter-sidebar-list--fill";
    }
    return undefined;
  })();

  return (
    <>
      <aside
        className={`lm-side ${sidebarCollapsed ? "lm-side-collapsed" : ""} ${
          showWorkbenchExplorer ? "lm-side-with-workbench-files" : ""
        }${showSideChat ? " lm-side-with-chat-sessions" : ""}`}
        style={{
          width: sidebarCollapsed ? 0 : sidebarWidth,
          flexShrink: 0,
          borderRight: sidebarCollapsed ? "none" : undefined,
        }}
        aria-hidden={sidebarCollapsed}
        aria-label="侧栏"
      >
        <div className="lm-brand">
          <div className="lm-logo-mark" aria-hidden="true">
            <LawmindBrandMark size={28} />
          </div>
          <div className="lm-brand-copy">
            <div className="lm-brand-title">LawMind</div>
          </div>
        </div>

        {/* 本机文件夹在上。最上面的新建放进工作区根目录，或设置里另选的目录。 */}
        {showSideChat && onCreateNewChatSession ? (
          <button
            type="button"
            className="lm-fs-dual-root-header lm-side-new-chat"
            data-testid="lm-side-new-chat"
            title={
              (newChatHomePath || workspaceFolderPath)
                ? `新建对话，放在默认工作区 ${newChatHomePath || workspaceFolderPath}`
                : "新建对话，放在默认工作区"
            }
            onClick={() => void onCreateNewChatSession()}
          >
            <span className="lm-side-new-chat-spacer" aria-hidden="true" />
            <span className="lm-section-label">新建对话</span>
            <span className="lm-fs-root-add" aria-hidden="true">
              ＋
            </span>
          </button>
        ) : null}

        {showWorkbenchExplorer ? (
          <div
            ref={setFileExplorerHost}
            className="lm-side-explorer-host lm-side-explorer-host--work"
            aria-label="本机目录"
            data-testid="lm-side-explorer-work"
          >
            {showExplorerSkeleton ? <LawmindSideExplorerSkeleton /> : null}
          </div>
        ) : null}

        {showSideChat &&
        onSelectChatSession &&
        onCreateNewChatSession &&
        onRenameChatSession &&
        onDeleteChatSession ? (
          <LawmindSideChatSessions
            sessions={chatSessions ?? []}
            activeSessionId={activeChatSessionId}
            loading={chatSessionsLoading}
            apiBase={apiBase}
            assistantId={chatAssistantId}
            knownMatterIds={knownMatterIdsFromRows(chatMatterRows ?? matterSidebarRows, chatMattersReady)}
            matterTitleById={matterTitleByIdFromRows(chatMatterRows ?? matterSidebarRows)}
            assistantDisplayById={assistantDisplayById}
            workspaceFolderLabel={workspaceFolderLabel}
            workspaceFolderPath={workspaceFolderPath}
            preferredWorkDir={newChatHomePath}
            onNewChatInFolder={onNewChatInFolder}
            onCreateChatWorkspace={onCreateChatWorkspace}
            onSelect={onSelectChatSession}
            onRename={onRenameChatSession}
            onDelete={onDeleteChatSession}
          />
        ) : null}

        {showMatterList ? (
          <LawmindMatterSidebarList
            className={matterListClassName}
            rows={matterSidebarRows}
            selectedKey={selectedMatterKey}
            onCreateMatter={onCreateMatter}
            onSelect={(mid) => {
              if (matterCockpitOpen) {
                onSelectMatterKey(mid);
              } else {
                onSelectMatterForCockpit(mid);
              }
            }}
          />
        ) : null}

        {/* Cursor 式账号行：左下角 头像 + 产品名 + 金色「更新」药丸 + 设置齿轮。 */}
        <LawmindSideAccountFooter
          settingsOpen={settingsOpen}
          onOpenSettings={onOpenSettings}
          onCloseSettings={onCloseSettings}
          updateStateTest={updateStateTest}
        />

      </aside>
      {!sidebarCollapsed ? (
        <div
          className="lm-split-handle lm-split-handle-vertical"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左栏宽度"
          title="拖动调整侧栏宽度"
          onPointerDown={onSidebarResizePointerDown}
        />
      ) : null}
    </>
  );
}

export const LawmindAppSidebar = React.memo(LawmindAppSidebarImpl);

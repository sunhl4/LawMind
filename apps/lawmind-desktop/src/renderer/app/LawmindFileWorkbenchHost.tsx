import React from "react";
import { FileWorkbench, type FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import type { RootKey } from "../file/file-workbench-types";

export type LawmindFileWorkbenchHostProps = {
  showSidebarWorkbenchFiles: boolean;
  workspaceDir: string;
  projectDir: string | null;
  fileExplorerHost: HTMLDivElement | null;
  fileEditorHost: HTMLDivElement | null;
  onAddToChatContext: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  mattersPickList: Array<{ id: string; label: string }>;
  workspaceTreeRefreshKey: number;
  apiBase: string;
  onOpenUnlinkedMatters: () => void;
  matterCockpitOpen: boolean;
  onToggleMatterCockpit: () => void;
  casesNodeActions: FileWorkbenchCasesNodeActions | null;
};

function LawmindFileWorkbenchHostImpl({
  showSidebarWorkbenchFiles,
  workspaceDir,
  projectDir,
  fileExplorerHost,
  fileEditorHost,
  onAddToChatContext,
  mattersPickList,
  workspaceTreeRefreshKey,
  apiBase,
  onOpenUnlinkedMatters,
  matterCockpitOpen,
  onToggleMatterCockpit,
  casesNodeActions,
}: LawmindFileWorkbenchHostProps) {
  if (!showSidebarWorkbenchFiles || !fileExplorerHost) {
    return null;
  }

  return (
    <FileWorkbench
      workspaceDir={workspaceDir}
      projectDir={projectDir}
      canUseFilesystemBridge
      onAddToChatContext={onAddToChatContext}
      portalHosts={{
        explorer: fileExplorerHost,
        editor: fileEditorHost ?? null,
        explorerLayout: "embedded",
      }}
      mattersPickList={mattersPickList}
      workspaceTreeRefreshKey={workspaceTreeRefreshKey}
      workspaceExplorerToolbar={
        <>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-small"
            disabled={!apiBase}
            title="打开案件工作台并筛选「未关联对话」案件"
            onClick={onOpenUnlinkedMatters}
          >
            未关联
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-small"
            disabled={!apiBase}
            title={
              matterCockpitOpen
                ? "关闭主区案件工作台，回到文件与对话"
                : "在主区打开案件工作台（驾驶舱）"
            }
            onClick={onToggleMatterCockpit}
          >
            {matterCockpitOpen ? "关闭案件" : "案件"}
          </button>
        </>
      }
      casesNodeActions={casesNodeActions}
    />
  );
}

export const LawmindFileWorkbenchHost = React.memo(LawmindFileWorkbenchHostImpl);

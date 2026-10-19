import React, { useEffect } from "react";
import { FileWorkbench, type FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import type { RootKey } from "../file/file-workbench-types";

export type LawmindFileWorkbenchHostProps = {
  showSidebarWorkbenchFiles: boolean;
  workspaceDir: string;
  projectDir: string | null;
  onPickProject?: () => void | Promise<void>;
  fileExplorerHost: HTMLDivElement | null;
  /** 左栏底部「案件材料」；与 fileExplorerHost（工作区）成对 portal。 */
  fileExplorerCasesHost: HTMLDivElement | null;
  fileEditorHost: HTMLDivElement | null;
  onExplorerPortaled?: (portaled: boolean) => void;
  onAddToChatContext: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  /** 在本机文件夹上新建一场挂在该文件夹的对话。 */
  onNewChatInFolder?: (folderRel: string) => void | Promise<void>;
  onCreateChatWorkspace?: (workDir: string) => void | Promise<void>;
  /** workspace = chat materials; meeting = agenda; agents = 在办补充带入 */
  explorerVariant?: "workspace" | "meeting" | "agents";
  mattersPickList: Array<{ id: string; label: string }>;
  workspaceTreeRefreshKey: number;
  casesNodeActions: FileWorkbenchCasesNodeActions | null;
  explorerMatterId?: string | null;
  materialsDefaultOpen?: boolean;
};

function LawmindFileWorkbenchHostImpl({
  showSidebarWorkbenchFiles,
  workspaceDir,
  projectDir,
  onPickProject,
  fileExplorerHost,
  fileExplorerCasesHost,
  fileEditorHost,
  onExplorerPortaled,
  onAddToChatContext,
  onNewChatInFolder,
  onCreateChatWorkspace,
  explorerVariant = "workspace",
  mattersPickList,
  workspaceTreeRefreshKey,
  casesNodeActions,
  explorerMatterId = null,
  materialsDefaultOpen = false,
}: LawmindFileWorkbenchHostProps) {
  useEffect(() => {
    const portaled = Boolean(showSidebarWorkbenchFiles && fileExplorerHost);
    onExplorerPortaled?.(portaled);
    return () => onExplorerPortaled?.(false);
  }, [showSidebarWorkbenchFiles, fileExplorerHost, onExplorerPortaled]);

  if (!showSidebarWorkbenchFiles || !fileExplorerHost) {
    return null;
  }

  const isMeeting = explorerVariant === "meeting";
  const isAgents = explorerVariant === "agents";
  const addToContextLabel = isMeeting
    ? "加入议题材料"
    : isAgents
      ? "加入补充材料"
      : undefined;

  return (
    <FileWorkbench
      workspaceDir={workspaceDir}
      projectDir={projectDir}
      onPickProject={onPickProject}
      canUseFilesystemBridge
      onAddToChatContext={onAddToChatContext}
      onNewChatInFolder={onNewChatInFolder}
      onCreateChatWorkspace={onCreateChatWorkspace}
      addToContextLabel={addToContextLabel}
      portalHosts={{
        explorer: fileExplorerHost,
        ...(fileExplorerCasesHost
          ? { explorerCases: fileExplorerCasesHost, explorerSections: "split" as const }
          : { explorerSections: "work" as const }),
        editor: isMeeting || isAgents ? null : (fileEditorHost ?? null),
        explorerLayout: "embedded",
      }}
      mattersPickList={mattersPickList}
      workspaceTreeRefreshKey={workspaceTreeRefreshKey}
      casesNodeActions={isMeeting || isAgents ? null : casesNodeActions}
      explorerMatterId={explorerMatterId}
      materialsDefaultOpen={materialsDefaultOpen}
    />
  );
}

export const LawmindFileWorkbenchHost = React.memo(LawmindFileWorkbenchHostImpl);

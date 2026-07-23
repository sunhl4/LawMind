import React, { useEffect } from "react";
import { FileWorkbench, type FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import type { RootKey } from "../file/file-workbench-types";

export type LawmindFileWorkbenchHostProps = {
  showSidebarWorkbenchFiles: boolean;
  workspaceDir: string;
  projectDir: string | null;
  onPickProject?: () => void | Promise<void>;
  fileExplorerHost: HTMLDivElement | null;
  fileEditorHost: HTMLDivElement | null;
  onExplorerPortaled?: (portaled: boolean) => void;
  onAddToChatContext: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  /** workspace = chat materials; meeting = agenda; agents = 在办补充带入 */
  explorerVariant?: "workspace" | "meeting" | "agents";
  mattersPickList: Array<{ id: string; label: string }>;
  workspaceTreeRefreshKey: number;
  casesNodeActions: FileWorkbenchCasesNodeActions | null;
};

function LawmindFileWorkbenchHostImpl({
  showSidebarWorkbenchFiles,
  workspaceDir,
  projectDir,
  onPickProject,
  fileExplorerHost,
  fileEditorHost,
  onExplorerPortaled,
  onAddToChatContext,
  explorerVariant = "workspace",
  mattersPickList,
  workspaceTreeRefreshKey,
  casesNodeActions,
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
      addToContextLabel={addToContextLabel}
      portalHosts={{
        explorer: fileExplorerHost,
        editor: isMeeting || isAgents ? null : (fileEditorHost ?? null),
        explorerLayout: "embedded",
      }}
      mattersPickList={mattersPickList}
      workspaceTreeRefreshKey={workspaceTreeRefreshKey}
      casesNodeActions={isMeeting || isAgents ? null : casesNodeActions}
    />
  );
}

export const LawmindFileWorkbenchHost = React.memo(LawmindFileWorkbenchHostImpl);

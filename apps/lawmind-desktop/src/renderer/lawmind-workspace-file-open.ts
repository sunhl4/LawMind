/** Cross-surface deep-link: open a workspace-relative path in the file workbench. */

export const LAWMIND_OPEN_WORKSPACE_FILE_EVENT = "lawmind:open-workspace-file";

export type OpenWorkspaceFileDetail = {
  /** Workspace-relative path (e.g. cases/<matter>/foo.docx). */
  relPath: string;
};

/**
 * 未消费路径登记：FileWorkbench 未挂载时事件会丢失，登记后在挂载时消费；
 * 已挂载的消费端处理事件时同步取走，避免重复打开。
 */
let pendingOpenPath: string | null = null;

export function requestOpenWorkspaceFile(relPath: string): void {
  const path = relPath.trim().replace(/^[/\\]+/, "");
  if (!path || typeof window === "undefined") {
    return;
  }
  pendingOpenPath = path;
  window.dispatchEvent(
    new CustomEvent<OpenWorkspaceFileDetail>(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, {
      detail: { relPath: path },
    }),
  );
}

/** 取走并清空待消费路径（事件处理或挂载消费时调用）。 */
export function consumePendingOpenWorkspaceFile(): string | null {
  const path = pendingOpenPath;
  pendingOpenPath = null;
  return path;
}

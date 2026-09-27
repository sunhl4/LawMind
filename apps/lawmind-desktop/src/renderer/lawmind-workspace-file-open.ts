/** Cross-surface deep-link: open a workspace-relative path in the file workbench. */

export const LAWMIND_OPEN_WORKSPACE_FILE_EVENT = "lawmind:open-workspace-file";

/** Reveal the chat middle column when a .docx is opened in the file workbench. */
export const LAWMIND_SHOW_WORD_SURFACE_EVENT = "lawmind:show-word-surface";

export type WorkspaceFileRoot = "workspace" | "project";

export type OpenWorkspaceFileDetail = {
  /** Workspace-relative path (e.g. cases/<matter>/foo.docx). */
  relPath: string;
  root?: WorkspaceFileRoot;
};

/** Open the contract's revision column instead of the full-document 改稿 desk. */
export const LAWMIND_OPEN_CONTRACT_REVISION_EVENT = "lawmind:open-contract-revision";

export type OpenContractRevisionDetail = {
  taskId?: string;
};

/**
 * 未消费路径登记：FileWorkbench 未挂载时事件会丢失，登记后在挂载时消费；
 * 已挂载的消费端处理事件时同步取走，避免重复打开。
 */
let pendingOpen: { relPath: string; root: WorkspaceFileRoot } | null = null;

export function requestOpenWorkspaceFile(relPath: string, root: WorkspaceFileRoot = "workspace"): void {
  const path = relPath.trim().replace(/^[/\\]+/, "");
  if (!path || typeof window === "undefined") {
    return;
  }
  pendingOpen = { relPath: path, root };
  window.dispatchEvent(
    new CustomEvent<OpenWorkspaceFileDetail>(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, {
      detail: { relPath: path, root },
    }),
  );
}

/** 取走并清空待消费路径（事件处理或挂载消费时调用）。 */
export function consumePendingOpenWorkspaceFile(): { relPath: string; root: WorkspaceFileRoot } | null {
  const pending = pendingOpen;
  pendingOpen = null;
  return pending;
}

export function requestOpenContractRevision(taskId?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<OpenContractRevisionDetail>(LAWMIND_OPEN_CONTRACT_REVISION_EVENT, {
      detail: { taskId: taskId?.trim() || "" },
    }),
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:/.test(value);
}

/** Which file the middle column should open for a contract revision. */
export function revisionColumnTarget(
  draft: {
    contractEdit?: { baselineRelativePath?: string; baselineRoot?: string };
    outputPath?: string;
  },
  workspaceDir?: string,
): { relPath: string; root: WorkspaceFileRoot } | null {
  const baseline = draft.contractEdit?.baselineRelativePath?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (baseline && !isAbsolutePath(baseline)) {
    return {
      relPath: baseline,
      root: draft.contractEdit?.baselineRoot === "project" ? "project" : "workspace",
    };
  }
  const output = draft.outputPath?.trim().replace(/\\/g, "/");
  if (!output || !/\.docx$/i.test(output)) {
    return null;
  }
  const ws = workspaceDir?.trim().replace(/\\/g, "/").replace(/\/$/, "");
  let rel = output;
  if (ws && (rel === ws || rel.startsWith(`${ws}/`))) {
    rel = rel.slice(ws.length).replace(/^\//, "");
  }
  if (isAbsolutePath(rel)) {
    return null;
  }
  return { relPath: rel, root: "workspace" };
}

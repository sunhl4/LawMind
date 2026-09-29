import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";

/** Cross-surface deep-link: open a workspace-relative path in the file workbench. */

export const LAWMIND_OPEN_WORKSPACE_FILE_EVENT = "lawmind:open-workspace-file";

/** Reveal the chat middle column when a .docx is opened in the file workbench. */
export const LAWMIND_SHOW_WORD_SURFACE_EVENT = "lawmind:show-word-surface";

export type WorkspaceFileRoot = "workspace" | "project";

export type OpenWorkspaceFileDetail = {
  /** Workspace-relative path (e.g. cases/<matter>/foo.docx). */
  relPath: string;
  root?: WorkspaceFileRoot;
  /** 1-based line to show in the text editor. Office files ignore this. */
  line?: number;
  column?: number;
};

export type RevealFileLineDetail = {
  root: WorkspaceFileRoot;
  relPath: string;
  line: number;
  column: number;
};

export const LAWMIND_REVEAL_FILE_LINE_EVENT = "lawmind:reveal-file-line";

let pendingReveal: RevealFileLineDetail | null = null;

function clampedLine(value: number | undefined): number | null {
  if (!value || !Number.isInteger(value) || value < 1 || value > 100_000) {
    return null;
  }
  return value;
}

export function offsetForLine(text: string, line: number, column = 1): { start: number; end: number } {
  const lines = text.split("\n");
  const index = Math.min(Math.max(line, 1), Math.max(lines.length, 1)) - 1;
  let start = 0;
  for (let i = 0; i < index; i += 1) {
    start += (lines[i]?.length ?? 0) + 1;
  }
  const lineText = lines[index] ?? "";
  const col = Math.min(Math.max(column, 1), lineText.length + 1);
  return { start: start + col - 1, end: start + lineText.length };
}

export function requestRevealFileLine(detail: RevealFileLineDetail): void {
  if (typeof window === "undefined") {
    return;
  }
  pendingReveal = detail;
  window.dispatchEvent(new CustomEvent<RevealFileLineDetail>(LAWMIND_REVEAL_FILE_LINE_EVENT, { detail }));
}

export function consumePendingRevealFileLine(): RevealFileLineDetail | null {
  const pending = pendingReveal;
  pendingReveal = null;
  return pending;
}

/**
 * The case that owns this opened file, or null when the file is not inside a case folder.
 * Project-root files and canvas files do not belong to whatever case the chat last used.
 */
export function matterIdOwnedByOpenedFile(
  relPath: string,
  root: WorkspaceFileRoot = "workspace",
): string | null {
  if (root !== "workspace") {
    return null;
  }
  const parts = relPath.trim().replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
  const id = parts[0] === "cases" ? parts[1]?.trim() ?? "" : "";
  return id && isValidMatterId(id) ? id : null;
}

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

export function requestOpenWorkspaceFile(
  relPath: string,
  root: WorkspaceFileRoot = "workspace",
  at?: { line?: number; column?: number },
): void {
  const path = relPath.trim().replace(/^[/\\]+/, "");
  if (!path || typeof window === "undefined") {
    return;
  }
  const line = clampedLine(at?.line);
  const column = line ? (clampedLine(at?.column) ?? 1) : null;
  pendingOpen = { relPath: path, root };
  window.dispatchEvent(
    new CustomEvent<OpenWorkspaceFileDetail>(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, {
      detail: {
        relPath: path,
        root,
        ...(line ? { line, column: column ?? 1 } : {}),
      },
    }),
  );
  if (line) {
    requestRevealFileLine({ root, relPath: path, line, column: column ?? 1 });
  }
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

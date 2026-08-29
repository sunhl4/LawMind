/**
 * In-desk post-approve export CTA state (Wave 3-A).
 */

export type PostApproveExportState = {
  taskId: string;
  matterId?: string;
  title: string;
  /** Last render attempt result */
  status: "idle" | "exporting" | "ok" | "error";
  outputPath?: string;
  errorMessage?: string;
  /** 签批已记但案件 deliverable 戳未写入 */
  matterWriteFailed?: boolean;
};

export const POST_APPROVE_EXPORT_STORAGE_PREFIX = "lawmind.postApproveExport.v1.";

export function postApproveExportStorageKey(taskId: string): string {
  return `${POST_APPROVE_EXPORT_STORAGE_PREFIX}${taskId.trim()}`;
}

function sessionStore(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}

export function persistPostApproveExport(state: PostApproveExportState | null): void {
  const store = sessionStore();
  if (!store || !state?.taskId.trim()) {
    return;
  }
  store.setItem(postApproveExportStorageKey(state.taskId), JSON.stringify(state));
}

export function clearPersistedPostApproveExport(taskId: string): void {
  const store = sessionStore();
  const id = taskId.trim();
  if (!store || !id) {
    return;
  }
  store.removeItem(postApproveExportStorageKey(id));
}

export function readPersistedPostApproveExport(taskId: string): PostApproveExportState | null {
  const store = sessionStore();
  const id = taskId.trim();
  if (!store || !id) {
    return null;
  }
  try {
    const raw = store.getItem(postApproveExportStorageKey(id));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PostApproveExportState;
    if (!parsed?.taskId || parsed.taskId !== id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createPostApproveExport(opts: {
  taskId: string;
  matterId?: string;
  title?: string;
  matterWriteFailed?: boolean;
}): PostApproveExportState {
  return {
    taskId: opts.taskId.trim(),
    matterId: opts.matterId?.trim() || undefined,
    title: (opts.title?.trim() || "已通过签批").replace(/^待审定：\s*/, ""),
    status: "idle",
    matterWriteFailed: opts.matterWriteFailed === true,
  };
}

export function markPostApproveExporting(state: PostApproveExportState): PostApproveExportState {
  return { ...state, status: "exporting", errorMessage: undefined };
}

export function markPostApproveOk(
  state: PostApproveExportState,
  outputPath: string,
): PostApproveExportState {
  return {
    ...state,
    status: "ok",
    outputPath: outputPath.trim(),
    errorMessage: undefined,
  };
}

export function markPostApproveError(
  state: PostApproveExportState,
  message: string,
): PostApproveExportState {
  return {
    ...state,
    status: "error",
    errorMessage: message.trim() || "导出失败",
  };
}

/** Success requires both ok and a non-empty output path (file on disk). */
export function applyPostApproveRenderResult(
  state: PostApproveExportState,
  ok: boolean,
  outputPath?: string,
  errorMessage?: string,
): PostApproveExportState {
  const path = outputPath?.trim() ?? "";
  if (ok && path) {
    return markPostApproveOk(state, path);
  }
  return markPostApproveError(
    state,
    errorMessage?.trim() || (ok ? "导出未落盘：未返回文件路径" : "导出失败"),
  );
}

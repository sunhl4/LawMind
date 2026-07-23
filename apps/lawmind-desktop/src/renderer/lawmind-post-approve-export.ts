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
};

export function createPostApproveExport(opts: {
  taskId: string;
  matterId?: string;
  title?: string;
}): PostApproveExportState {
  return {
    taskId: opts.taskId.trim(),
    matterId: opts.matterId?.trim() || undefined,
    title: (opts.title?.trim() || "已通过签批").replace(/^待审定：\s*/, ""),
    status: "idle",
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

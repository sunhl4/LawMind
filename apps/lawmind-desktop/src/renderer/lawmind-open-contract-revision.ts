/**
 * 从在办 / 对话打开合同修订窗：先切到工作台，再按 taskId 打开原件并露出 Word 修订列。
 */
import { apiGetJson } from "./api-client";
import {
  LAWMIND_SHOW_WORD_SURFACE_EVENT,
  requestOpenWorkspaceFile,
  revisionColumnTarget,
} from "./lawmind-workspace-file-open";

export const LAWMIND_PREPARE_WORKSPACE_FILE_EVENT = "lawmind:prepare-workspace-file";

export function prepareWorkspaceForFileOpen(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(LAWMIND_PREPARE_WORKSPACE_FILE_EVENT));
}

export async function openContractRevisionForTask(opts: {
  apiBase: string;
  taskId: string;
  workspaceDir?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const taskId = opts.taskId?.trim();
  if (!taskId) {
    return { ok: false, error: "缺少任务编号，无法打开修订窗。" };
  }
  if (!opts.apiBase?.trim()) {
    return { ok: false, error: "本地服务未就绪，请稍后再试。" };
  }
  prepareWorkspaceForFileOpen();
  try {
    const body = await apiGetJson<{
      ok?: boolean;
      draft?: Parameters<typeof revisionColumnTarget>[0];
    }>(opts.apiBase, `/api/drafts/${encodeURIComponent(taskId)}`);
    const target = body.draft ? revisionColumnTarget(body.draft, opts.workspaceDir) : null;
    if (!target) {
      return {
        ok: false,
        error: "找不到合同原件路径。请确认这份草稿已绑定 Word 原件。",
      };
    }
    requestOpenWorkspaceFile(target.relPath, target.root);
    window.dispatchEvent(new CustomEvent(LAWMIND_SHOW_WORD_SURFACE_EVENT));
    return { ok: true };
  } catch {
    return { ok: false, error: "打开修订窗失败，请稍后重试。" };
  }
}

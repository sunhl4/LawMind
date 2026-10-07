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

type ReviewDraftRef = {
  taskId?: string;
  title?: string;
  outputPath?: string;
  contractEdit?: { baselineRelativePath?: string };
};

function normPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileNameOf(value: string): string {
  const path = normPath(value);
  return path.split("/").pop() ?? path;
}

function dirOf(value: string): string {
  const path = normPath(value);
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function reviewStem(fileName: string): string {
  return fileName.replace(/\.docx$/i, "").replace(/_\d{8}_\d{2}$/, "");
}

/** 对话里点到的可能是审阅稿。核对要打开绑了修订的原件。 */
export function taskIdForReviewFile(drafts: readonly ReviewDraftRef[], relPath: string): string | null {
  const path = normPath(relPath);
  if (!path) {
    return null;
  }
  const name = fileNameOf(path);
  const dir = dirOf(path);
  const stem = reviewStem(name);
  let sameStem: string | null = null;
  let titled: string | null = null;
  for (const draft of drafts) {
    const taskId = draft.taskId?.trim();
    if (!taskId) {
      continue;
    }
    const baseline = normPath(draft.contractEdit?.baselineRelativePath ?? "");
    const output = normPath(draft.outputPath ?? "");
    if (baseline === path) {
      return taskId;
    }
    const outputName = fileNameOf(output);
    const outputDir = dirOf(output);
    const baselineDir = dirOf(baseline);
    const sameDir =
      !dir ||
      dir === outputDir ||
      dir === baselineDir ||
      outputDir.endsWith(`/${dir}`) ||
      baselineDir.endsWith(`/${dir}`);
    if (output && (output === path || output.endsWith(`/${path}`))) {
      return taskId;
    }
    if (output && sameDir && outputName === name) {
      return taskId;
    }
    if (baseline && sameDir && reviewStem(fileNameOf(baseline)) === stem) {
      sameStem = sameStem ?? taskId;
    }
    const title = draft.title?.trim();
    const baselineStem = baseline ? reviewStem(fileNameOf(baseline)) : "";
    const titleHit = title === stem;
    const prefixedCopy =
      baselineStem.length >= 8 && stem.length > baselineStem.length && stem.endsWith(baselineStem);
    if (sameDir && (titleHit || prefixedCopy)) {
      titled = titled ?? taskId;
    }
  }
  return titled ?? sameStem;
}

/** 对话里点一份 Word：打开中间栏的核对画面。项目目录里的稿不在工作区根上。 */
export async function openDocxInReviewSurface(opts: {
  relPath: string;
  apiBase?: string;
  workspaceDir?: string;
  /** 找到绑了修订的任务后，交给审核台，而不是只打开预览。 */
  onTask?: (taskId: string) => void;
}): Promise<void> {
  const path = normPath(opts.relPath);
  if (!path || typeof window === "undefined") {
    return;
  }
  if (opts.apiBase?.trim()) {
    try {
      const body = await apiGetJson<{ ok?: boolean; drafts?: ReviewDraftRef[] }>(opts.apiBase, "/api/drafts");
      const taskId = taskIdForReviewFile(body.drafts ?? [], path);
      if (taskId && opts.onTask) {
        opts.onTask(taskId);
        return;
      }
      if (taskId) {
        await openContractRevisionForTask({
          apiBase: opts.apiBase,
          taskId,
          workspaceDir: opts.workspaceDir,
        });
        return;
      }
    } catch {
      /* 对不上草稿时仍打开这份文件。 */
    }
  }
  prepareWorkspaceForFileOpen();
  requestOpenWorkspaceFile(path, path.startsWith("cases/") ? "workspace" : "project");
  window.dispatchEvent(new CustomEvent(LAWMIND_SHOW_WORD_SURFACE_EVENT));
}

/** 对话里点非 Word 交付件：打开中间栏。项目目录里的稿不在工作区根上。 */
export function openDeliverableInMiddleColumn(relPath: string): void {
  const path = normPath(relPath);
  if (!path || typeof window === "undefined") {
    return;
  }
  prepareWorkspaceForFileOpen();
  requestOpenWorkspaceFile(path, path.startsWith("cases/") ? "workspace" : "project");
}

/**
 * A chat copy can share the draft's title while the revisions sit on another
 * original. Open that original so the rail and the marks have a proposal.
 */
export async function openBoundBaselineIfDifferent(opts: {
  apiBase: string;
  relPath: string;
  workspaceDir?: string;
}): Promise<void> {
  const path = normPath(opts.relPath);
  if (!path || !opts.apiBase?.trim() || typeof window === "undefined") {
    return;
  }
  try {
    const body = await apiGetJson<{ ok?: boolean; drafts?: ReviewDraftRef[] }>(opts.apiBase, "/api/drafts");
    const taskId = taskIdForReviewFile(body.drafts ?? [], path);
    if (!taskId) {
      return;
    }
    const draft = (body.drafts ?? []).find((row) => row.taskId === taskId);
    const baseline = normPath(draft?.contractEdit?.baselineRelativePath ?? "");
    if (!baseline || baseline === path) {
      return;
    }
    await openContractRevisionForTask({
      apiBase: opts.apiBase,
      taskId,
      workspaceDir: opts.workspaceDir,
    });
  } catch {
    /* 对不上就留在当前这份文件上。 */
  }
}

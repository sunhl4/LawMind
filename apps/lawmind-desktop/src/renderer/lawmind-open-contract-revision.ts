/**
 * 从在办 / 对话打开合同修订窗：先切到工作台，再按 taskId 打开原件并露出 Word 修订列。
 */
import { apiGetJson } from "./api-client";
import {
  defaultRootForRelPath,
  LAWMIND_SHOW_WORD_SURFACE_EVENT,
  lastOpenTargetError,
  reportOpenFileFailure,
  requestOpenWorkspaceFile,
  resolveWorkspaceFileTarget,
  revisionColumnTarget,
  type WorkspaceFileRoot,
} from "./lawmind-workspace-file-open";

export const LAWMIND_PREPARE_WORKSPACE_FILE_EVENT = "lawmind:prepare-workspace-file";

/** 草稿还没有 Word 时，中栏改开草稿台，而不是停在「找不到原件」。 */
export const LAWMIND_OPEN_DRAFT_DESK_EVENT = "lawmind:open-draft-desk";

export type OpenDraftDeskDetail = { taskId: string };

let pendingDraftDeskId: string | null = null;
/** 当前已经挂在中栏的草稿台 taskId（不是 pending）。拖出中栏时用它带上上下文。 */
let activeDraftDeskId: string | null = null;

export function currentDraftDeskTaskId(): string | null {
  return activeDraftDeskId;
}

export function setCurrentDraftDeskTaskId(taskId: string | null): void {
  activeDraftDeskId = taskId?.trim() || null;
}

export function prepareWorkspaceForFileOpen(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(LAWMIND_PREPARE_WORKSPACE_FILE_EVENT));
}

export function requestOpenDraftDesk(taskId: string): boolean {
  const id = taskId.trim();
  if (!id || typeof window === "undefined") {
    return false;
  }
  pendingDraftDeskId = id;
  activeDraftDeskId = id;
  prepareWorkspaceForFileOpen();
  window.dispatchEvent(
    new CustomEvent<OpenDraftDeskDetail>(LAWMIND_OPEN_DRAFT_DESK_EVENT, { detail: { taskId: id } }),
  );
  return true;
}

/** 不取走。重挂载时仍能回到同一份草稿，直到律师打开文件或点「回到文件」。 */
export function peekPendingDraftDesk(): string | null {
  return pendingDraftDeskId;
}

export function clearPendingDraftDesk(): void {
  pendingDraftDeskId = null;
  activeDraftDeskId = null;
}

function openMiddleColumnFile(
  relPath: string,
  projectDir?: string,
  rootHint?: WorkspaceFileRoot,
): void {
  const path = normPath(relPath);
  if (!path || typeof window === "undefined") {
    return;
  }
  prepareWorkspaceForFileOpen();
  requestOpenWorkspaceFile(path, rootHint ?? defaultRootForRelPath(path, projectDir));
  if (/\.docx?$/i.test(path)) {
    window.dispatchEvent(new CustomEvent(LAWMIND_SHOW_WORD_SURFACE_EVENT));
  }
}

export async function openContractRevisionForTask(opts: {
  apiBase: string;
  taskId: string;
  workspaceDir?: string;
  projectDir?: string;
  /** 草稿没有可打开的 Word 时，改开用户点的这份文件。 */
  fallbackRelPath?: string;
  /** fallback 文件在哪个根（lm-wps 链接自带溯源；缺省时按路径猜）。 */
  fallbackRootHint?: WorkspaceFileRoot;
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
    const target = body.draft
      ? revisionColumnTarget(body.draft, opts.workspaceDir, opts.projectDir)
      : null;
    if (target) {
      requestOpenWorkspaceFile(target.relPath, target.root);
      window.dispatchEvent(new CustomEvent(LAWMIND_SHOW_WORD_SURFACE_EVENT));
      return { ok: true };
    }
    const fallback = normPath(opts.fallbackRelPath ?? "");
    if (fallback) {
      openMiddleColumnFile(fallback, opts.projectDir, opts.fallbackRootHint);
      return { ok: true };
    }
    if (body.draft && requestOpenDraftDesk(taskId)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: body.draft
        ? "找不到合同原件路径。请确认这份草稿已绑定 Word 原件。"
        : "找不到这份草稿。",
    };
  } catch {
    return { ok: false, error: "打开修订窗失败，请稍后重试。" };
  }
}

type ReviewDraftRef = {
  taskId?: string;
  title?: string;
  outputPath?: string;
  contractEdit?: { baselineRelativePath?: string; baselineRoot?: string };
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

/** 对话里点一份 Word：有绑定原件就开修订，否则打开点到的这份文件。 */
export async function openDocxInReviewSurface(opts: {
  relPath: string;
  apiBase?: string;
  workspaceDir?: string;
  projectDir?: string;
  /** 链接自带根溯源（外部文件是 `file:<id>`）。 */
  rootHint?: WorkspaceFileRoot;
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
      const drafts = body.drafts ?? [];
      const taskId = taskIdForReviewFile(drafts, path);
      const draft = taskId ? drafts.find((row) => row.taskId === taskId) : undefined;
      const target = draft ? revisionColumnTarget(draft, opts.workspaceDir, opts.projectDir) : null;
      if (taskId && target && opts.onTask) {
        opts.onTask(taskId);
        return;
      }
      if (taskId && target) {
        const opened = await openContractRevisionForTask({
          apiBase: opts.apiBase,
          taskId,
          workspaceDir: opts.workspaceDir,
          projectDir: opts.projectDir,
          fallbackRelPath: path,
          ...(opts.rootHint ? { fallbackRootHint: opts.rootHint } : {}),
        });
        if (opened.ok) {
          return;
        }
      }
    } catch {
      /* 对不上草稿时仍打开这份文件。 */
    }
  }
  openMiddleColumnFile(path, opts.projectDir, opts.rootHint);
}

/** 对话里点非 Word 交付件：打开中间栏。项目目录里的稿不在工作区根上。 */
export function openDeliverableInMiddleColumn(
  relPath: string,
  projectDir?: string,
): void {
  const path = normPath(relPath);
  if (!path || typeof window === "undefined") {
    return;
  }
  prepareWorkspaceForFileOpen();
  requestOpenWorkspaceFile(path, defaultRootForRelPath(path, projectDir));
}

/**
 * 审核台/在办/导出条共用的「交付件 → 中栏」入口。
 *
 * 草稿的 `outputPath` 是磁盘绝对路径：先按工作区/项目夹归一，再走对话链接同一条
 * 中栏入口，不另开一条打开路径。
 */
export async function openReviewedOutputInMiddleColumn(
  outputPath: string,
  opts?: { workspaceDir?: string | null; projectDir?: string | null },
): Promise<boolean> {
  const target = await resolveWorkspaceFileTarget(outputPath, opts);
  if (!target) {
    return false;
  }
  // 根必须原样传下去：外部根的 rel 只是文件名，按 workspace 解析会 404。
  openInRoot(target.rel, target.root);
  return true;
}

/** 按已解析好的根打开：中栏唯一的打开入口。 */
function openInRoot(relPath: string, root: WorkspaceFileRoot): void {
  const path = normPath(relPath);
  if (!path || typeof window === "undefined") {
    return;
  }
  prepareWorkspaceForFileOpen();
  requestOpenWorkspaceFile(path, root);
  if (/\.docx?$/i.test(path)) {
    window.dispatchEvent(new CustomEvent(LAWMIND_SHOW_WORD_SURFACE_EVENT));
  }
}

/**
 * 对话里点到的工作区外文件。
 *
 * 产品规则：对话**产出**的文件一律在会话工作区 / 案件目录里（见交付路径），
 * 所以这里遇到外部路径只有一种来源——律师让助手找的一个既有文件。
 * 那种文件按 Cursor 的手感处理：按次授权成同级根，**权限与工作区相同**（可读可写）。
 */
export async function openAnyFileInMiddleColumn(
  rawPath: string,
  opts?: {
    workspaceDir?: string | null;
    projectDir?: string | null;
  },
): Promise<boolean> {
  const raw = (rawPath ?? "").trim();
  if (!raw || typeof window === "undefined") {
    return false;
  }
  const target = await resolveWorkspaceFileTarget(raw, opts);
  if (!target) {
    reportOpenFileFailure(
      `打不开这个文件：${raw}（${lastOpenTargetError() ?? "路径无效"}）`,
    );
    return false;
  }
  openInRoot(target.rel, target.root);
  return true;
}

/**
 * A chat copy can share the draft's title while the revisions sit on another
 * original. Open that original so the rail and the marks have a proposal.
 */
export async function openBoundBaselineIfDifferent(opts: {
  apiBase: string;
  relPath: string;
  workspaceDir?: string;
  projectDir?: string;
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
    const target = draft ? revisionColumnTarget(draft, opts.workspaceDir, opts.projectDir) : null;
    if (!target || target.relPath === path) {
      return;
    }
    await openContractRevisionForTask({
      apiBase: opts.apiBase,
      taskId,
      workspaceDir: opts.workspaceDir,
      projectDir: opts.projectDir,
      fallbackRelPath: path,
    });
  } catch {
    /* 对不上就留在当前这份文件上。 */
  }
}

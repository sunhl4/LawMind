import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { resolveRelForAbs } from "./lawmind-workspace-relpath";

/** Cross-surface deep-link: open a workspace-relative path in the file workbench. */

export const LAWMIND_OPEN_WORKSPACE_FILE_EVENT = "lawmind:open-workspace-file";

/** Reveal the chat middle column when a .docx is opened in the file workbench. */
export const LAWMIND_SHOW_WORD_SURFACE_EVENT = "lawmind:show-word-surface";

/** 只属于文件树的两个真根（选中态、材料归属、写保护都只认它们）。 */
export type WritableFileRoot = "workspace" | "project";

/**
 * 可读写根：工作区 / 项目夹 / 按次授权的 `file:<id>`。
 *
 * 三者在读写上**权限相同**（Cursor 手感）：工作区外的文件打开后一样能改。
 * 差别只在语义：外部根不进文件树、不参与「材料已选」与案件归属。
 */
export type WorkspaceFileRoot = WritableFileRoot | `file:${string}`;

/** 同义别名：读代码时「任意可读写根」比 WorkspaceFileRoot 更准确。 */
export type AnyFileRoot = WorkspaceFileRoot;

function dirnameOfRel(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash >= 0 ? relPath.slice(0, slash) : "";
}

function basenameOfRel(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash >= 0 ? relPath.slice(slash + 1) : relPath;
}

/**
 * 相对路径到底在哪个根下。
 *
 * 对话里的链接只带相对路径（`artifacts/x.docx`），而同一相对路径既可能在项目夹、
 * 也可能在工作区：交付件默认落项目夹，没有项目夹时落工作区 `artifacts/`。
 * 先列父目录确认，不猜。
 */
async function relPathExistsUnderRoot(
  root: WorkspaceFileRoot,
  relPath: string,
): Promise<boolean> {
  const list = typeof window !== "undefined" ? window.lawmindDesktop?.fsList : undefined;
  if (typeof list !== "function") {
    return false;
  }
  try {
    const res = await list({ root, path: dirnameOfRel(relPath) });
    if (!res?.ok) {
      return false;
    }
    const name = basenameOfRel(relPath);
    return (res.entries ?? []).some((entry) => entry.name === name);
  } catch {
    return false;
  }
}

/**
 * 深链的根提示可能过时。先按提示根找；找不到再看另一个根。
 * 都找不到时保留提示根，让中栏照常报错，不把「文件不存在」伪装成成功打开。
 */
export async function resolveExistingRootForRelPath(
  relPath: string,
  preferredRoot: WritableFileRoot = "workspace",
): Promise<WritableFileRoot> {
  const rel = relPath.trim().replace(/\\/g, "/").replace(/^[/\\]+/, "");
  if (!rel) {
    return preferredRoot;
  }
  if (await relPathExistsUnderRoot(preferredRoot, rel)) {
    return preferredRoot;
  }
  const other: WorkspaceFileRoot = preferredRoot === "workspace" ? "project" : "workspace";
  if (await relPathExistsUnderRoot(other, rel)) {
    return other;
  }
  return preferredRoot;
}

function isAbsoluteDiskPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function normRelPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^[/\\]+/, "");
}

/**
 * 只知道相对路径时该先问哪个根：`cases/…` 必然在工作区；其余跟着会话走
 * （挂了本机项目夹就先问项目夹）。**只是「先问谁」**，真实位置由
 * `resolveWorkspaceFileTarget` 列目录确认。
 */
export function defaultRootForRelPath(
  relPath: string,
  projectDir?: string | null,
): WorkspaceFileRoot {
  const rel = normRelPath(relPath);
  if (rel.startsWith("cases/")) {
    return "workspace";
  }
  return projectDir?.trim() ? "project" : "workspace";
}

/**
 * 磁盘路径或相对路径 → 「哪个根 + 相对路径」。
 *
 * 只解析工作区与项目夹：交付件一律生成在这两个根里（见 default-output-location），
 * 真在根外的路径返回 null，由调用方**复制进本案**再打开，而不是就地改外部文件。
 */
/** 授权根 → 目录。用于「在访达中显示」这类需要绝对路径的地方。 */
const externalRootDirs = new Map<string, string>();

export function grantedFileRootDir(rootKey: string): string | undefined {
  return externalRootDirs.get(rootKey);
}

/** 上一次「打不开」的具体原因。 */
let lastError: string | null = null;

export function lastOpenTargetError(): string | null {
  return lastError;
}

/**
 * 工作区外的真实文件：按次登记成同级根（与工作区同权限）。
 *
 * 产品规则：律师让助手找一个工作区外的文件时，那个文件必须能打开、能改
 * （Cursor 的手感）。主进程负责校验存在性、是否文件、拒绝名单、是否已在工作区内。
 */
async function grantExternalFile(
  absPath: string,
): Promise<{ root: AnyFileRoot; rel: string } | null> {
  lastError = null;
  const grant =
    typeof window !== "undefined" ? window.lawmindDesktop?.grantFileAccess : undefined;
  if (typeof grant !== "function") {
    lastError = "当前环境不能打开本机文件，请用桌面版 LawMind。";
    return null;
  }
  try {
    const res = await grant(absPath);
    if (!res?.ok || !res.root) {
      lastError = res?.error ?? "这份文件打不开。";
      return null;
    }
    const dir = (res as { dirPath?: string }).dirPath;
    if (dir) {
      externalRootDirs.set(res.root, dir);
    }
    return {
      root: res.root as AnyFileRoot,
      rel: res.rel ?? absPath.split(/[/\\]/).pop() ?? "",
    };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

/**
 * 路径 → 「哪个根 + 相对路径」。
 *
 * 对话产出的文件永远在会话工作区/案件目录里（由交付路径决定），所以这里是
 * 「相对路径归到哪个根」；只有当律师从别处拉进来或让助手找到工作区外文件时，
 * 才会走到按次授权那条分支。
 */
export async function resolveWorkspaceFileTarget(
  rawPath: string,
  opts?: { workspaceDir?: string | null; projectDir?: string | null },
): Promise<{ root: AnyFileRoot; rel: string } | null> {
  const raw = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!raw) {
    return null;
  }
  const workspaceDir = opts?.workspaceDir?.trim() ?? "";
  const projectDir = opts?.projectDir?.trim() ?? "";
  lastError = null;
  if (isAbsoluteDiskPath(raw)) {
    const mapped = resolveRelForAbs(workspaceDir, projectDir, raw);
    if (mapped?.rel) {
      return { root: mapped.root, rel: mapped.rel };
    }
    // 工作区外：按次授权成同级根（可读可写）。
    return grantExternalFile(raw);
  }
  const rel = normRelPath(raw);
  if (!rel) {
    return null;
  }
  // 相对路径只可能在两个真根里：外部根必然来自绝对路径授权。
  const root = await resolveExistingRootForRelPath(
    rel,
    projectDir?.trim() && !rel.startsWith("cases/") ? "project" : "workspace",
  );
  return { root, rel };
}

/** 工作区/项目夹内的路径 → 目标；不在两个根里时给出可执行的说法。 */
export async function resolveWorkspaceFileTargetOrExplain(
  rawPath: string,
  opts?: { workspaceDir?: string | null; projectDir?: string | null },
): Promise<{ root: AnyFileRoot; rel: string } | null> {
  lastError = null;
  const target = await resolveWorkspaceFileTarget(rawPath, opts);
  if (target) {
    return target;
  }
  const raw = (rawPath ?? "").trim();
  // 保留更具体的原因（例如主进程说「已经不在磁盘上了」），别被这句话盖掉。
  lastError ??= isAbsoluteDiskPath(raw)
    ? "这个文件不在工作区或项目目录内。"
    : "找不到这个文件。";
  return null;
}

export type OpenWithSystemResult = { ok: true } | { ok: false; error: string };

/**
 * 用本机默认应用打开一份交付件。**这是唯一入口**：
 * 先归一 `{root, rel}`，再交给文件桥，避免把项目夹里的稿当工作区相对路径去解析。
 */
export async function openWithSystemForPath(
  rawPath: string,
  opts?: { workspaceDir?: string | null; projectDir?: string | null },
): Promise<OpenWithSystemResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "当前不在桌面应用里，无法调用本机应用。" };
  }
  const open = window.lawmindDesktop?.openWithSystem;
  if (typeof open !== "function") {
    return { ok: false, error: "当前环境无法调用本机应用，请用「在访达中显示」后手动打开。" };
  }
  const target = await resolveWorkspaceFileTargetOrExplain(rawPath, opts);
  if (!target) {
    return {
      ok: false,
      error: lastError ?? "打不开这个文件。",
    };
  }
  const res = await open({ root: target.root, path: target.rel });
  if (res && !res.ok) {
    return { ok: false, error: res.error ?? "无法用本机应用打开该文件。" };
  }
  return { ok: true };
}

/** 打开文件前先让中栏露出来（编辑区默认是收起的）。 */
export const LAWMIND_PREPARE_WORKSPACE_FILE_EVENT = "lawmind:prepare-workspace-file";

/**
 * 打开失败的通知通道：对话里的链接以前没有消费者，打不开时界面什么都不说。
 */
export const LAWMIND_OPEN_FILE_FAILED_EVENT = "lawmind:open-file-failed";

export function reportOpenFileFailure(message: string): void {
  const text = message.trim();
  if (!text || typeof window === "undefined") {
    return;
  }
  // 中栏默认收起：不露出来，提示条就等于没写。
  window.dispatchEvent(new CustomEvent(LAWMIND_PREPARE_WORKSPACE_FILE_EVENT));
  window.dispatchEvent(
    new CustomEvent<{ message: string }>(LAWMIND_OPEN_FILE_FAILED_EVENT, {
      detail: { message: text },
    }),
  );
}

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
  projectDir?: string,
): { relPath: string; root: WorkspaceFileRoot } | null {
  const baseline = draft.contractEdit?.baselineRelativePath?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (baseline && !isAbsolutePath(baseline)) {
    return {
      relPath: baseline,
      root: draft.contractEdit?.baselineRoot === "project" ? "project" : "workspace",
    };
  }
  if (baseline && isAbsolutePath(baseline)) {
    const mapped = resolveRelForAbs(workspaceDir, projectDir, baseline);
    if (mapped?.rel) {
      return { relPath: mapped.rel, root: mapped.root };
    }
  }
  const output = draft.outputPath?.trim().replace(/\\/g, "/");
  if (!output || !/\.docx$/i.test(output)) {
    return null;
  }
  if (isAbsolutePath(output)) {
    const mapped = resolveRelForAbs(workspaceDir, projectDir, output);
    return mapped?.rel ? { relPath: mapped.rel, root: mapped.root } : null;
  }
  const ws = workspaceDir?.trim().replace(/\\/g, "/").replace(/\/$/, "");
  let rel = output;
  if (ws && (rel === ws || rel.startsWith(`${ws}/`))) {
    rel = rel.slice(ws.length).replace(/^\//, "");
  }
  if (isAbsolutePath(rel) || !rel) {
    return null;
  }
  return { relPath: rel, root: "workspace" };
}

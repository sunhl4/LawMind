import {
  publicWebUrl,
  safeWorkspaceRelativePath,
  wpsDeliverablePath,
  workspacePathTarget,
} from "../../../../../src/lawmind/sources/lawyer-chat-link.ts";
import {
  requestOpenWorkspaceFile,
  type WorkspaceFileRoot,
} from "../lawmind-workspace-file-open";
import { resolveOpenableOutputPath } from "../lawmind-app-utils";

/** Host actions a canvas can ask for. The iframe only posts a message; the parent window runs these. */

export const LAWMIND_CANVAS_COMPOSER_EVENT = "lawmind:canvas-composer";
export const LAWMIND_CANVAS_EXPORT_EVENT = "lawmind:canvas-export";
export const LAWMIND_CANVAS_EXPORT_RESULT_EVENT = "lawmind:canvas-export-result";

export type CanvasComposerDetail = {
  prompt: string;
  canvasPath?: string;
  root?: "workspace" | "project";
};
export type CanvasExportDetail = { root: string; path: string };
export type CanvasExportResultDetail = {
  root: string;
  path: string;
  ok: boolean;
  htmlPath?: string;
  message: string;
};

/** 把当前画布写进提问，律师能点开，模型也能按相对路径读到。 */
export function canvasComposerDraft(prompt: string, canvasPath?: string): string {
  const text = prompt.trim();
  if (!text) {
    return "";
  }
  const path = canvasPath ? safeWorkspaceRelativePath(canvasPath) : null;
  if (!path || !/\.canvas\.tsx$/i.test(path)) {
    return text;
  }
  const name = path.split("/").pop() || path;
  return `请看 [${name}](${path})。\n${text}`;
}

export function requestCanvasComposer(
  prompt: string,
  canvas?: { root?: string; path?: string },
): void {
  const text = prompt.trim();
  if (!text || typeof window === "undefined") {
    return;
  }
  const path = canvas?.path ? safeWorkspaceRelativePath(canvas.path) : null;
  const canvasPath = path && /\.canvas\.tsx$/i.test(path) ? path : undefined;
  window.dispatchEvent(
    new CustomEvent<CanvasComposerDetail>(LAWMIND_CANVAS_COMPOSER_EVENT, {
      detail: {
        prompt: text,
        ...(canvasPath
          ? {
              canvasPath,
              root: canvas?.root === "project" ? "project" : "workspace",
            }
          : {}),
      },
    }),
  );
}

/** 交付文件只交给本机 WPS。先试工作区，再试本机文件夹（project）。 */
export async function openDeliverableInWps(
  relPath: string,
  preferredRoot: WorkspaceFileRoot = "workspace",
): Promise<{ ok: boolean; error?: string }> {
  const safe = wpsDeliverablePath(relPath);
  if (!safe || typeof window === "undefined") {
    return { ok: false, error: "这份文件不能用 WPS 打开。" };
  }
  const openWithWps = window.lawmindDesktop?.openWithWps;
  if (!openWithWps) {
    return { ok: false, error: "请完全退出 LawMind 后重新打开桌面版，再用 WPS 打开。" };
  }
  const roots: WorkspaceFileRoot[] =
    preferredRoot === "project" ? ["project", "workspace"] : ["workspace", "project"];
  let lastError = "WPS 没有打开这份文件。";
  for (const root of roots) {
    try {
      const result = await openWithWps({ root, path: safe });
      if (result?.ok) {
        return { ok: true };
      }
      if (result?.error) {
        lastError = result.error;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/No handler registered/i.test(msg)) {
        return {
          ok: false,
          error: "桌面主进程还是旧版。请完全退出 LawMind 后重新运行 pnpm lawmind:desktop。",
        };
      }
      lastError = msg || lastError;
    }
  }
  return { ok: false, error: lastError };
}

/** 在访达里显示审阅稿。先试工作区，再试本机项目文件夹。 */
export async function revealDeliverableInFolder(
  relPath: string,
): Promise<{ ok: boolean; error?: string }> {
  const safe = wpsDeliverablePath(relPath);
  const show = typeof window !== "undefined" ? window.lawmindDesktop?.showItemInFolder : undefined;
  const getConfig = typeof window !== "undefined" ? window.lawmindDesktop?.getConfig : undefined;
  if (!safe || !show || !getConfig) {
    return { ok: false, error: "现在不能在文件夹里显示这份文件。" };
  }
  const config = await getConfig();
  const roots = [config.workspaceDir, config.projectDir].filter(
    (root): root is string => Boolean(root?.trim()),
  );
  let lastError = "找不到这份文件。";
  for (const root of roots) {
    try {
      const result = await show(resolveOpenableOutputPath(root, safe));
      if (result?.ok) {
        return { ok: true };
      }
      if (result?.error && result.error !== "not found" && result.error !== "outside_allowed_roots") {
        lastError = result.error;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
    }
  }
  return { ok: false, error: lastError };
}

/** 公网地址交给系统浏览器。内网和带账号密码的地址直接丢掉。 */
export function openLawyerExternalUrl(url: string): void {
  const safe = publicWebUrl(url);
  if (!safe || typeof window === "undefined") {
    return;
  }
  if (window.lawmindDesktop?.openExternal) {
    void window.lawmindDesktop.openExternal(safe);
    return;
  }
  window.open(safe, "_blank", "noopener,noreferrer");
}

/**
 * 画布或对话里的地址。工作区相对路径在编辑区打开，公网地址用浏览器打开。
 * 绝对路径和 `..` 打不开。`fileRoot` 跟当前画布所在根（workspace / project）一致。
 */
export function openLawyerHref(
  href: string,
  fileRoot: WorkspaceFileRoot = "workspace",
): boolean {
  const target = workspacePathTarget(href);
  if (target) {
    requestOpenWorkspaceFile(target.path, fileRoot, {
      ...(target.line ? { line: target.line } : {}),
      ...(target.column ? { column: target.column } : {}),
    });
    return true;
  }
  const url = publicWebUrl(href);
  if (!url) {
    return false;
  }
  openLawyerExternalUrl(url);
  return true;
}

export function requestCanvasExport(root: string, path: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<CanvasExportDetail>(LAWMIND_CANVAS_EXPORT_EVENT, { detail: { root, path } }),
  );
}

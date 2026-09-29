import {
  publicWebUrl,
  safeWorkspaceRelativePath,
  workspacePathTarget,
} from "../../../../../src/lawmind/sources/lawyer-chat-link.ts";
import {
  requestOpenWorkspaceFile,
  type WorkspaceFileRoot,
} from "../lawmind-workspace-file-open";

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

/** Host actions a canvas can ask for. The iframe only posts a message; the parent window runs these. */

export const LAWMIND_CANVAS_COMPOSER_EVENT = "lawmind:canvas-composer";
export const LAWMIND_CANVAS_EXPORT_EVENT = "lawmind:canvas-export";
export const LAWMIND_CANVAS_EXPORT_RESULT_EVENT = "lawmind:canvas-export-result";

export type CanvasComposerDetail = { prompt: string };
export type CanvasExportDetail = { root: string; path: string };
export type CanvasExportResultDetail = {
  root: string;
  path: string;
  ok: boolean;
  htmlPath?: string;
  message: string;
};

export function requestCanvasComposer(prompt: string): void {
  const text = prompt.trim();
  if (!text || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<CanvasComposerDetail>(LAWMIND_CANVAS_COMPOSER_EVENT, { detail: { prompt: text } }),
  );
}

export function requestCanvasExport(root: string, path: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<CanvasExportDetail>(LAWMIND_CANVAS_EXPORT_EVENT, { detail: { root, path } }),
  );
}

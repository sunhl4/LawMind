/** Unified LawMind panel sizing (Cursor-like split constraints). */

export const LM_PANE_MIN_WIDTH_PX = 240;
export const LM_PANE_MAX_WIDTH_PX = 560;

export const LM_CHAT_COMPOSE_MIN_HEIGHT_PX = 140;
export const LM_CHAT_COMPOSE_MAX_HEIGHT_PX = 480;
export const LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX = 220;

/** 左栏：文件树 与 下方在办/助手区 之间可拖动的分区高度 */
export const LM_SIDE_FILE_TREE_MIN_HEIGHT_PX = 72;
export const LM_SIDE_FILE_TREE_MAX_HEIGHT_PX = 520;
export const LM_SIDE_FILE_TREE_DEFAULT_HEIGHT_PX = 220;

/** Clamp horizontal pane width to [min, max] and cap by viewport so panes stay usable. */
export function clampPaneWidthPx(width: number, min = LM_PANE_MIN_WIDTH_PX, max = LM_PANE_MAX_WIDTH_PX): number {
  let capMax = max;
  try {
    if (typeof window !== "undefined" && Number.isFinite(window.innerWidth)) {
      capMax = Math.min(max, Math.max(min, Math.floor(window.innerWidth * 0.5)));
    }
  } catch {
    /* ignore */
  }
  return Math.min(capMax, Math.max(min, Math.round(width)));
}

export function clampComposeHeightPx(
  height: number,
  min = LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
  max = LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
): number {
  let capMax = max;
  try {
    if (typeof window !== "undefined" && Number.isFinite(window.innerHeight)) {
      capMax = Math.min(max, Math.max(min, Math.floor(window.innerHeight * 0.62)));
    }
  } catch {
    /* ignore */
  }
  return Math.min(capMax, Math.max(min, Math.round(height)));
}

export function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "1" || v === "true") {
      return true;
    }
    if (v === "0" || v === "false") {
      return false;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

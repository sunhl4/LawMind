/** Unified LawMind panel sizing (Cursor-like split constraints). */

export const LM_PANE_MIN_WIDTH_PX = 240;
export const LM_PANE_MAX_WIDTH_PX = 560;

/** Slim Cursor-style compose: textarea + one toolbar row; chrome above is optional. */
export const LM_CHAT_COMPOSE_MIN_HEIGHT_PX = 108;
export const LM_CHAT_COMPOSE_MAX_HEIGHT_PX = 360;
export const LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX = 120;

/** 对话输入区在极矮窗口下的最低高度（须 ≤ DEFAULT，否则默认会被抬高） */
export const LM_COMPOSE_HARD_MIN_PX = 96;

/** 左栏：文件树 与 下方在办/助手区 之间可拖动的分区高度 */
export const LM_SIDE_FILE_TREE_MIN_HEIGHT_PX = 72;
export const LM_SIDE_FILE_TREE_MAX_HEIGHT_PX = 520;
export const LM_SIDE_FILE_TREE_DEFAULT_HEIGHT_PX = 220;

/** 窄窗口下分栏不得低于此宽度（可小于 LM_PANE_MIN_WIDTH_PX） */
export const LM_PANE_RESPONSIVE_FLOOR_PX = 160;

/** @deprecated 使用 LM_PANE_RESPONSIVE_FLOOR_PX */
export const LM_SIDEBAR_HARD_MIN_PX = LM_PANE_RESPONSIVE_FLOOR_PX;

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

/**
 * 应用壳 **左侧栏总宽**（材料树 + 侧栏栈）：窄窗口时允许小于 LM_PANE_MIN_WIDTH_PX，
 * 并把上限钉在视口比例内，避免主区被挤到无法操作。
 */
export function clampSidebarWidthPx(
  width: number,
  min = LM_PANE_MIN_WIDTH_PX,
  max = LM_PANE_MAX_WIDTH_PX,
): number {
  try {
    if (typeof window !== "undefined" && Number.isFinite(window.innerWidth)) {
      const vw = window.innerWidth;
      const minResponsive = Math.max(LM_PANE_RESPONSIVE_FLOOR_PX, Math.min(min, Math.floor(vw * 0.3)));
      const maxResponsive = Math.min(max, Math.max(minResponsive + 40, Math.floor(vw * 0.5)));
      return Math.min(maxResponsive, Math.max(minResponsive, Math.round(width)));
    }
  } catch {
    /* ignore */
  }
  return Math.min(max, Math.max(min, Math.round(width)));
}

/**
 * 主区内水平分栏：对话列、案件/审核列表、材料侧轨等。
 * 随视口缩小允许低于 LM_PANE_MIN_WIDTH_PX，并限制占屏上限（左栏已另占一部分宽度）。
 */
export function clampInnerSplitWidthPx(
  width: number,
  min = LM_PANE_MIN_WIDTH_PX,
  max = LM_PANE_MAX_WIDTH_PX,
): number {
  try {
    if (typeof window !== "undefined" && Number.isFinite(window.innerWidth)) {
      const vw = window.innerWidth;
      const minResponsive = Math.max(LM_PANE_RESPONSIVE_FLOOR_PX, Math.min(min, Math.floor(vw * 0.26)));
      const maxResponsive = Math.min(max, Math.max(minResponsive + 48, Math.floor(vw * 0.46)));
      return Math.min(maxResponsive, Math.max(minResponsive, Math.round(width)));
    }
  } catch {
    /* ignore */
  }
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function clampComposeHeightPx(
  height: number,
  min = LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
  max = LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
): number {
  try {
    if (typeof window !== "undefined" && Number.isFinite(window.innerHeight)) {
      const vh = window.innerHeight;
      const minResponsive = Math.max(LM_COMPOSE_HARD_MIN_PX, Math.min(min, Math.floor(vh * 0.2)));
      const maxResponsive = Math.min(max, Math.max(minResponsive + 56, Math.floor(vh * 0.56)));
      return Math.min(maxResponsive, Math.max(minResponsive, Math.round(height)));
    }
  } catch {
    /* ignore */
  }
  return Math.min(max, Math.max(min, Math.round(height)));
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

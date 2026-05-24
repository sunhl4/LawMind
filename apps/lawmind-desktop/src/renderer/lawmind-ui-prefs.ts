const WORK_TAB_KEY = "lm.ui.workTab.v1";
const FONT_SCALE_KEY = "lm.ui.fontScale.v1";

export type UiFontScale = "default" | "comfortable";

export function readWorkTabEnabled(): boolean {
  try {
    return localStorage.getItem(WORK_TAB_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWorkTabEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(WORK_TAB_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readUiFontScale(): UiFontScale {
  try {
    return localStorage.getItem(FONT_SCALE_KEY) === "comfortable" ? "comfortable" : "default";
  } catch {
    return "default";
  }
}

export function writeUiFontScale(scale: UiFontScale): void {
  try {
    localStorage.setItem(FONT_SCALE_KEY, scale);
  } catch {
    /* ignore */
  }
}

export function applyUiFontScale(scale: UiFontScale): void {
  const root = document.documentElement;
  if (scale === "comfortable") {
    root.dataset.lmFontScale = "comfortable";
  } else {
    delete root.dataset.lmFontScale;
  }
}

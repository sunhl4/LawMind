const FONT_SCALE_KEY = "lm.ui.fontScale.v1";
const DENSITY_KEY = "lm.ui.density.v1";
const REDUCED_MOTION_KEY = "lm.ui.reducedMotion.v1";
const THEME_KEY = "lm.ui.theme.v1";

export type UiFontScale = "default" | "comfortable";
export type UiDensity = "default" | "compact";
/** Default is light (skills epic mockups). */
export type UiTheme = "light" | "dark";

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

export function readUiDensity(): UiDensity {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "default";
  } catch {
    return "default";
  }
}

export function writeUiDensity(density: UiDensity): void {
  try {
    localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* ignore */
  }
}

export function readReducedMotionForced(): boolean {
  try {
    return localStorage.getItem(REDUCED_MOTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeReducedMotionForced(forced: boolean): void {
  try {
    localStorage.setItem(REDUCED_MOTION_KEY, forced ? "1" : "0");
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

export function applyUiDensity(density: UiDensity): void {
  const root = document.documentElement;
  if (density === "compact") {
    root.classList.add("lm-density-compact");
  } else {
    root.classList.remove("lm-density-compact");
  }
}

export function readUiTheme(): UiTheme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeUiTheme(theme: UiTheme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function applyUiTheme(theme: UiTheme): void {
  document.documentElement.classList.toggle("lm-theme-dark", theme === "dark");
}

export function applyReducedMotionForced(forced: boolean): void {
  const on = forced || systemPrefersReducedMotion();
  document.documentElement.classList.toggle("lm-reduced-motion", on);
}

export function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Apply all persisted UI prefs to `document.documentElement`. */
export function applyAllUiPrefs(): void {
  applyUiTheme(readUiTheme());
  applyUiFontScale(readUiFontScale());
  applyUiDensity(readUiDensity());
  applyReducedMotionForced(readReducedMotionForced());
}

export function resetDefaultPanelLayout(): void {
  const keys = [
    "lawmind.ui.sidebarCollapsed",
    "lawmind.ui.meetingMaterialsCollapsed",
    "lawmind.ui.wsPaneEditor",
    "lawmind.ui.wsPaneChat",
  ];
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function resetSidebarWidthPreference(): void {
  try {
    localStorage.removeItem("lawmind.ui.sidebarWidth");
  } catch {
    /* ignore */
  }
}

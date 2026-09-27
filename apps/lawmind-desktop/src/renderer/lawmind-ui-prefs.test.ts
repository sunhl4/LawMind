/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyReducedMotionForced,
  applyUiDensity,
  applyUiTheme,
  readUiDensity,
  readUiFontScale,
  readUiTheme,
  resetDefaultPanelLayout,
  writeUiDensity,
  writeUiFontScale,
  writeUiTheme,
} from "./lawmind-ui-prefs";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("lawmind-ui-prefs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
    document.documentElement.className = "";
    delete document.documentElement.dataset.lmFontScale;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists font scale and density", () => {
    writeUiFontScale("large");
    writeUiDensity("compact");
    expect(readUiFontScale()).toBe("large");
    expect(readUiDensity()).toBe("compact");
    applyUiDensity("compact");
    expect(document.documentElement.classList.contains("lm-density-compact")).toBe(true);
  });

  it("scales the whole window, not only tokenized text", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles/utilities.css"), "utf8");
    expect(css).toContain('html[data-lm-font-scale="small"] body');
    expect(css).toContain('html[data-lm-font-scale="large"] body');
    expect(css).toContain("zoom: calc(12 / 14)");
    expect(css).toContain("zoom: calc(16 / 14)");
    expect(css).not.toMatch(/html\[data-lm-font-scale="small"\]\s*\{[^}]*--fs-md/);
  });

  it("maps the old comfortable font scale to large", () => {
    localStorage.setItem("lm.ui.fontScale.v1", "comfortable");
    expect(readUiFontScale()).toBe("large");
    writeUiFontScale("small");
    expect(readUiFontScale()).toBe("small");
    writeUiFontScale("default");
    expect(readUiFontScale()).toBe("default");
  });

  it("defaults to light theme and toggles dark class", () => {
    expect(readUiTheme()).toBe("light");
    applyUiTheme("light");
    expect(document.documentElement.classList.contains("lm-theme-dark")).toBe(false);
    writeUiTheme("dark");
    applyUiTheme("dark");
    expect(readUiTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("lm-theme-dark")).toBe(true);
  });

  it("resetDefaultPanelLayout clears layout keys", () => {
    localStorage.setItem("lawmind.ui.sidebarCollapsed", "1");
    localStorage.setItem("lawmind.ui.wsPaneEditor", "0");
    resetDefaultPanelLayout();
    expect(localStorage.getItem("lawmind.ui.sidebarCollapsed")).toBeNull();
    expect(localStorage.getItem("lawmind.ui.wsPaneEditor")).toBeNull();
  });

  it("applyReducedMotionForced honors system prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    applyReducedMotionForced(false);
    expect(document.documentElement.classList.contains("lm-reduced-motion")).toBe(true);
  });
});

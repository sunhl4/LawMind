/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyReducedMotionForced,
  applyUiDensity,
  readUiDensity,
  readUiFontScale,
  resetDefaultPanelLayout,
  writeUiDensity,
  writeUiFontScale,
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
    writeUiFontScale("comfortable");
    writeUiDensity("compact");
    expect(readUiFontScale()).toBe("comfortable");
    expect(readUiDensity()).toBe("compact");
    applyUiDensity("compact");
    expect(document.documentElement.classList.contains("lm-density-compact")).toBe(true);
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

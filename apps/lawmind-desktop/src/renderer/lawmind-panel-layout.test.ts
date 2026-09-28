/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampInnerSplitWidthPx,
  clampSidebarWidthPx,
  LM_PANE_MAX_WIDTH_PX,
  readStoredBool,
} from "./lawmind-panel-layout";

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

describe("lawmind-panel-layout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("readStoredBool parses 1/0", () => {
    vi.stubGlobal("localStorage", mockStorage());
    localStorage.setItem("lawmind.ui.test", "1");
    expect(readStoredBool("lawmind.ui.test", false)).toBe(true);
    localStorage.setItem("lawmind.ui.test", "0");
    expect(readStoredBool("lawmind.ui.test", true)).toBe(false);
  });

  it("clampSidebarWidthPx respects bounds", () => {
    expect(clampSidebarWidthPx(100)).toBeGreaterThanOrEqual(160);
    expect(clampSidebarWidthPx(9999)).toBeLessThanOrEqual(LM_PANE_MAX_WIDTH_PX);
  });

  it("lets the sidebar and the inner split travel well past the old 560px cap on a desktop window", () => {
    vi.stubGlobal("window", { innerWidth: 1280 });
    expect(clampSidebarWidthPx(9999)).toBe(960);
    expect(clampSidebarWidthPx(700)).toBe(700);
    expect(clampInnerSplitWidthPx(9999)).toBe(793);
    expect(clampInnerSplitWidthPx(640)).toBe(640);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampSidebarWidthPx, readStoredBool } from "./lawmind-panel-layout";

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
    expect(clampSidebarWidthPx(9999)).toBeLessThanOrEqual(560);
  });
});

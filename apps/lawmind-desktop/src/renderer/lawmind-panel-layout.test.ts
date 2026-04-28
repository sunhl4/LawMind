import { afterEach, describe, expect, it, vi } from "vitest";
import { clampPaneWidthPx, readStoredBool } from "./lawmind-panel-layout.js";

describe("lawmind-panel-layout", () => {
  it("clamps pane width to min/max", () => {
    expect(clampPaneWidthPx(100, 240, 560)).toBe(240);
    expect(clampPaneWidthPx(800, 240, 560)).toBe(560);
    expect(clampPaneWidthPx(300, 240, 560)).toBe(300);
  });

  it("reads stored booleans", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    const key = "lawmind.test.bool";
    expect(readStoredBool(key, true)).toBe(true);
    store.set(key, "1");
    expect(readStoredBool(key, false)).toBe(true);
    store.set(key, "0");
    expect(readStoredBool(key, true)).toBe(false);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

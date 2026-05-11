import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampComposeHeightPx,
  clampInnerSplitWidthPx,
  clampPaneWidthPx,
  clampSidebarWidthPx,
  LM_PANE_RESPONSIVE_FLOOR_PX,
  readStoredBool,
} from "./lawmind-panel-layout.js";

describe("lawmind-panel-layout", () => {
  it("clamps pane width to min/max", () => {
    expect(clampPaneWidthPx(100, 240, 560)).toBe(240);
    expect(clampPaneWidthPx(800, 240, 560)).toBe(560);
    expect(clampPaneWidthPx(300, 240, 560)).toBe(300);
  });

  it("clamps shell sidebar on small viewports (main column stays usable)", () => {
    vi.stubGlobal("window", { innerWidth: 420 });
    const w = clampSidebarWidthPx(282, 240, 560);
    expect(w).toBeLessThanOrEqual(Math.floor(420 * 0.5));
    expect(w).toBeGreaterThanOrEqual(LM_PANE_RESPONSIVE_FLOOR_PX);
    vi.unstubAllGlobals();
  });

  it("clamps inner split width on small viewports", () => {
    vi.stubGlobal("window", { innerWidth: 480 });
    const w = clampInnerSplitWidthPx(380, 240, 560);
    expect(w).toBeLessThanOrEqual(Math.floor(480 * 0.46));
    expect(w).toBeGreaterThanOrEqual(LM_PANE_RESPONSIVE_FLOOR_PX);
    vi.unstubAllGlobals();
  });

  it("clamps compose height on short viewports", () => {
    vi.stubGlobal("window", { innerHeight: 520 });
    const h = clampComposeHeightPx(220, 140, 480);
    expect(h).toBeLessThanOrEqual(Math.floor(520 * 0.56));
    expect(h).toBeGreaterThanOrEqual(100);
    vi.unstubAllGlobals();
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

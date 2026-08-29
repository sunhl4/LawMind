import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY,
  readAllowWebSearchPreference,
  writeAllowWebSearchPreference,
} from "./lawmind-web-search-prefs.js";

describe("lawmind-web-search-prefs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to configured when user never toggled", () => {
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
    expect(readAllowWebSearchPreference(true)).toBe(true);
    expect(readAllowWebSearchPreference(false)).toBe(false);
  });

  it("persists explicit user choice", () => {
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
    writeAllowWebSearchPreference(false);
    expect(store.get(LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY)).toBe("0");
    expect(readAllowWebSearchPreference(true)).toBe(false);
    writeAllowWebSearchPreference(true);
    expect(readAllowWebSearchPreference(false)).toBe(true);
  });
});

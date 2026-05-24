import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSelectedModelId, writeSelectedModelId } from "./lawmind-selected-model-pref";

describe("lawmind-selected-model-pref", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
  });

  it("stores per-assistant model ids", () => {
    writeSelectedModelId("builtin:a", "assistant-1");
    writeSelectedModelId("builtin:b", "assistant-2");
    expect(readSelectedModelId("assistant-1")).toBe("builtin:a");
    expect(readSelectedModelId("assistant-2")).toBe("builtin:b");
  });

  it("falls back to global key when assistant has no mapping", () => {
    writeSelectedModelId("builtin:global");
    expect(readSelectedModelId("assistant-x")).toBe("builtin:global");
  });
});

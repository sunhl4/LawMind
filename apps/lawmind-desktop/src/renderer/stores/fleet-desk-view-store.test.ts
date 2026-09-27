/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetFleetDeskViewStoreForTest,
  useFleetDeskViewStore,
} from "./fleet-desk-view-store";

const SNOOZE_STORAGE_KEY = "lawmind-agents-snooze:v1";

function mockStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  };
}

function state() {
  return useFleetDeskViewStore.getState();
}

beforeEach(() => {
  vi.stubGlobal("localStorage", mockStorage());
  resetFleetDeskViewStoreForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fleet-desk-view-store", () => {
  it("初始为全部案件", () => {
    expect(state().matterFilter).toBe("all");
    expect(state().snoozed.size).toBe(0);
  });

  it("resetFiltersForDeepLink 落到指定案件；空案件回全部", () => {
    state().setMatterFilter("matter-other");
    state().resetFiltersForDeepLink("matter-1");
    expect(state().matterFilter).toBe("matter-1");
    state().resetFiltersForDeepLink(null);
    expect(state().matterFilter).toBe("all");
  });

  it("resetTransient 清掉案件筛选，稍后看还在", () => {
    state().snooze("run-1");
    state().setMatterFilter("matter-1");
    state().resetTransient();
    expect(state().matterFilter).toBe("all");
    expect(state().snoozed.has("run-1")).toBe(true);
  });

  it("snooze 加入集合并写 localStorage", () => {
    state().snooze("run-9");
    expect(state().snoozed.has("run-9")).toBe(true);
    expect(JSON.parse(localStorage.getItem(SNOOZE_STORAGE_KEY) ?? "[]")).toContain("run-9");
  });
});

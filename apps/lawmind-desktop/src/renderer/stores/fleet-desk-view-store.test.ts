/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLEET_COLLAPSED_STORAGE_KEY } from "../lawmind-fleet-queue";
import type { AgentRunSummary } from "../lawmind-agent-fleet-api";
import {
  resetFleetDeskViewStoreForTest,
  useFleetDeskViewStore,
} from "./fleet-desk-view-store";

const SNOOZE_STORAGE_KEY = "lawmind-agents-snooze:v1";

function group(kind: "review" | "clarify" | "approve") {
  return { kind, items: [{} as AgentRunSummary] };
}

function mockStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
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

describe("fleet-desk-view-store 瞬时切片", () => {
  it("初始为团队视图、无筛选、分组全空", () => {
    expect(state().listMode).toBe("team");
    expect(state().matterFilter).toBe("all");
    expect(state().assistantFilter).toBeNull();
    expect(state().expandedGroups.size).toBe(0);
  });

  it("switchListMode 切队列时清空成员筛选；setListMode 不动筛选", () => {
    state().selectAssistant("a1");
    expect(state().assistantFilter).toBe("a1");
    state().setListMode("queue");
    expect(state().assistantFilter).toBe("a1");
    state().switchListMode("team");
    state().selectAssistant("a1");
    state().switchListMode("queue");
    expect(state().listMode).toBe("queue");
    expect(state().assistantFilter).toBeNull();
  });

  it("selectAssistant 带筛选并回到团队视图；selectAllAssistants 清除", () => {
    state().switchListMode("queue");
    state().selectAssistant("a2");
    expect(state().listMode).toBe("team");
    expect(state().assistantFilter).toBe("a2");
    state().selectAllAssistants();
    expect(state().assistantFilter).toBeNull();
  });

  it("resetFiltersForDeepLink 放开筛选并切队列；空案件回全部", () => {
    state().selectAssistant("a1");
    state().resetFiltersForDeepLink("matter-1");
    expect(state().matterFilter).toBe("matter-1");
    expect(state().assistantFilter).toBeNull();
    expect(state().listMode).toBe("queue");
    state().resetFiltersForDeepLink(null);
    expect(state().matterFilter).toBe("all");
  });

  it("resetTransient 复位瞬时态但保留持久化切片", () => {
    state().snooze("run-1");
    state().syncExpandedGroups([group("review")]);
    state().toggleGroup("review");
    state().selectAssistant("a1");
    state().setMatterFilter("matter-1");
    state().resetTransient();
    expect(state().listMode).toBe("team");
    expect(state().matterFilter).toBe("all");
    expect(state().assistantFilter).toBeNull();
    expect(state().expandedGroups.size).toBe(0);
    expect(state().snoozed.has("run-1")).toBe(true);
    expect(state().userCollapsedGroups.has("review")).toBe(true);
  });
});

describe("fleet-desk-view-store 分组展开", () => {
  it("syncExpandedGroups 默认展开非空组并剔除手折", () => {
    state().syncExpandedGroups([group("review")]);
    state().toggleGroup("review");
    state().syncExpandedGroups([
      group("review"),
      group("approve"),
    ]);
    expect(state().expandedGroups.has("review")).toBe(false);
    expect(state().expandedGroups.has("approve")).toBe(true);
  });

  it("syncExpandedGroups 内容相同则不触发 set（引用不变）", () => {
    const groups = [group("review")];
    state().syncExpandedGroups(groups);
    const before = state().expandedGroups;
    state().syncExpandedGroups(groups);
    expect(state().expandedGroups).toBe(before);
  });

  it("toggleGroup 折叠写手折并持久化，再展开则移除手折", () => {
    state().syncExpandedGroups([group("review")]);
    expect(state().expandedGroups.has("review")).toBe(true);
    state().toggleGroup("review");
    expect(state().expandedGroups.has("review")).toBe(false);
    expect(state().userCollapsedGroups.has("review")).toBe(true);
    expect(JSON.parse(localStorage.getItem(FLEET_COLLAPSED_STORAGE_KEY) ?? "[]")).toContain(
      "review",
    );
    state().toggleGroup("review");
    expect(state().expandedGroups.has("review")).toBe(true);
    expect(state().userCollapsedGroups.has("review")).toBe(false);
    expect(JSON.parse(localStorage.getItem(FLEET_COLLAPSED_STORAGE_KEY) ?? "[]")).not.toContain(
      "review",
    );
  });

  it("expandGroup 幂等；expandOnlyGroup 只保留目标组", () => {
    state().syncExpandedGroups([
      group("review"),
      group("clarify"),
    ]);
    const before = state().expandedGroups;
    state().expandGroup("review");
    expect(state().expandedGroups).toBe(before);
    state().expandOnlyGroup("approve");
    expect([...state().expandedGroups]).toEqual(["approve"]);
  });
});

describe("fleet-desk-view-store 稍后看", () => {
  it("snooze 加入集合并写 localStorage", () => {
    state().snooze("run-9");
    expect(state().snoozed.has("run-9")).toBe(true);
    expect(JSON.parse(localStorage.getItem(SNOOZE_STORAGE_KEY) ?? "[]")).toContain("run-9");
  });
});

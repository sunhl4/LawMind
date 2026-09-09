/**
 * 在办左栏视图状态 — zustand 域 store 试点（见 stores/README.md）。
 * 域边界：团队/队列模式、案件与成员筛选、分组展开/手折、「稍后看」。
 * 只被在办面板树（LawmindAgentFleetPanel / LawmindAgentFleetListAside）消费；
 * 选中项（selectedId）与办理区业务状态仍留在组件 useState —— 见 README 的划分约定。
 *
 * 持久化对齐原 useState 语义：snoozed / userCollapsedGroups 写 localStorage；
 * 其余为瞬时态，面板重挂载时经 resetFleetDeskViewTransient 复位。
 */
import { create } from "zustand";
import {
  defaultExpandedFleetGroups,
  persistFleetCollapsedGroups,
  readFleetCollapsedGroups,
  type FleetGroupKind,
  type FleetQueueGroup,
} from "../lawmind-fleet-queue";

const FLEET_SNOOZE_STORAGE_KEY = "lawmind-agents-snooze:v1";

function readFleetSnoozed(): Set<string> {
  try {
    const raw = localStorage.getItem(FLEET_SNOOZE_STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function persistFleetSnoozed(next: Set<string>): Set<string> {
  try {
    localStorage.setItem(FLEET_SNOOZE_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* quota/private mode */
  }
  return next;
}

export type FleetDeskListMode = "team" | "queue";

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

export type FleetDeskViewState = {
  listMode: FleetDeskListMode;
  matterFilter: string;
  assistantFilter: string | null;
  snoozed: ReadonlySet<string>;
  /** 用户手动折叠的分组（持久化）；刷新后从默认展开集中剔除。 */
  userCollapsedGroups: ReadonlySet<FleetGroupKind>;
  expandedGroups: ReadonlySet<FleetGroupKind>;
  /** 仅切模式（深链/聚焦效果用），不动成员筛选。 */
  setListMode: (mode: FleetDeskListMode) => void;
  /** 用户点 Tab 切模式：切到队列时清空成员筛选。 */
  switchListMode: (mode: FleetDeskListMode) => void;
  setMatterFilter: (matterId: string) => void;
  /** 选中成员：带筛选并回到团队视图（展开/选中行的联动留在调用方）。 */
  selectAssistant: (assistantId: string) => void;
  selectAllAssistants: () => void;
  /** 深链到达：放开案件/成员筛选并切队列，避免在错误滤镜下匹配失败。 */
  resetFiltersForDeepLink: (matterId: string | null) => void;
  snooze: (runId: string) => void;
  toggleGroup: (kind: FleetGroupKind) => void;
  /** 展开某组（不动手折记录；深链定位与办结推进时用）。 */
  expandGroup: (kind: FleetGroupKind) => void;
  /** 只保留某组展开（成员下钻时用）。 */
  expandOnlyGroup: (kind: FleetGroupKind) => void;
  /** 队列变化后按「默认展开非空组 − 手折」重算；内容相同则不动，避免轮询多渲染。 */
  syncExpandedGroups: (queueGroups: Array<Pick<FleetQueueGroup, "kind" | "items">>) => void;
  /** 面板重挂载时复位瞬时态（持久化切片保留），对齐原 useState 初始语义。 */
  resetTransient: () => void;
};

const transientDefaults = {
  listMode: "team" as FleetDeskListMode,
  matterFilter: "all",
  assistantFilter: null,
  expandedGroups: new Set<FleetGroupKind>(),
};

export const useFleetDeskViewStore = create<FleetDeskViewState>()((set, get) => ({
  ...transientDefaults,
  snoozed: readFleetSnoozed(),
  userCollapsedGroups: readFleetCollapsedGroups(),

  setListMode: (mode) => set({ listMode: mode }),

  switchListMode: (mode) =>
    set(mode === "queue" ? { listMode: mode, assistantFilter: null } : { listMode: mode }),

  setMatterFilter: (matterId) => set({ matterFilter: matterId }),

  selectAssistant: (assistantId) => set({ assistantFilter: assistantId, listMode: "team" }),

  selectAllAssistants: () => set({ assistantFilter: null }),

  resetFiltersForDeepLink: (matterId) =>
    set({ matterFilter: matterId ?? "all", assistantFilter: null, listMode: "queue" }),

  snooze: (runId) => set({ snoozed: persistFleetSnoozed(new Set(get().snoozed).add(runId)) }),

  toggleGroup: (kind) => {
    const { expandedGroups, userCollapsedGroups } = get();
    const nextExpanded = new Set(expandedGroups);
    const nextCollapsed = new Set(userCollapsedGroups);
    if (nextExpanded.has(kind)) {
      nextExpanded.delete(kind);
      nextCollapsed.add(kind);
    } else {
      nextExpanded.add(kind);
      nextCollapsed.delete(kind);
    }
    set({
      expandedGroups: nextExpanded,
      userCollapsedGroups: persistFleetCollapsedGroups(nextCollapsed),
    });
  },

  expandGroup: (kind) => {
    const prev = get().expandedGroups;
    if (prev.has(kind)) {
      return;
    }
    set({ expandedGroups: new Set(prev).add(kind) });
  },

  expandOnlyGroup: (kind) => set({ expandedGroups: new Set([kind]) }),

  syncExpandedGroups: (queueGroups) => {
    const next = defaultExpandedFleetGroups(queueGroups);
    for (const kind of get().userCollapsedGroups) {
      next.delete(kind);
    }
    if (sameSet(next, get().expandedGroups)) {
      return;
    }
    set({ expandedGroups: next });
  },

  resetTransient: () => set({ ...transientDefaults, expandedGroups: new Set() }),
}));

/** 测试用：回到模块初始状态（并重读持久化切片）。 */
export function resetFleetDeskViewStoreForTest(): void {
  useFleetDeskViewStore.setState({
    ...transientDefaults,
    expandedGroups: new Set(),
    snoozed: new Set(),
    userCollapsedGroups: new Set(),
  });
}

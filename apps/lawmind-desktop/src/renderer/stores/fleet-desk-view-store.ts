/**
 * 在办左栏视图状态。
 * 交办册的展开收在面板里；这里只留案件筛选和「稍后看」。
 * 选中项与办理区仍留在组件 useState。
 *
 * 「稍后看」写入 localStorage。案件筛选是瞬时态，面板重挂载时经 resetTransient 复位。
 */
import { create } from "zustand";

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

export type FleetDeskViewState = {
  matterFilter: string;
  snoozed: ReadonlySet<string>;
  setMatterFilter: (matterId: string) => void;
  /** 深链到达：放开案件筛选，避免在错误滤镜下匹配失败。 */
  resetFiltersForDeepLink: (matterId: string | null) => void;
  snooze: (runId: string) => void;
  snoozeMany: (runIds: readonly string[]) => void;
  /** 面板重挂载时复位瞬时态（稍后看保留）。 */
  resetTransient: () => void;
};

const transientDefaults = {
  matterFilter: "all",
};

export const useFleetDeskViewStore = create<FleetDeskViewState>()((set, get) => ({
  ...transientDefaults,
  snoozed: readFleetSnoozed(),

  setMatterFilter: (matterId) => set({ matterFilter: matterId }),

  resetFiltersForDeepLink: (matterId) => set({ matterFilter: matterId ?? "all" }),

  snooze: (runId) => set({ snoozed: persistFleetSnoozed(new Set(get().snoozed).add(runId)) }),

  snoozeMany: (runIds) => {
    if (runIds.length === 0) {
      return;
    }
    const next = new Set(get().snoozed);
    for (const id of runIds) {
      next.add(id);
    }
    set({ snoozed: persistFleetSnoozed(next) });
  },

  resetTransient: () => set({ ...transientDefaults }),
}));

/** 测试用：回到模块初始状态（并重读持久化切片）。 */
export function resetFleetDeskViewStoreForTest(): void {
  useFleetDeskViewStore.setState({
    ...transientDefaults,
    snoozed: new Set(),
  });
}

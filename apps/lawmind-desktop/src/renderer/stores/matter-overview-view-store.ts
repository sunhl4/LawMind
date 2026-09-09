/**
 * 案件概览面板视图状态 — zustand 域 store。
 * 域边界：工作队列过滤/排序 + 洞察折叠展开。
 * 仅被 MatterOverviewBody 消费；MatterWorkbench 不再向下传递这些 UI 状态。
 */
import { create } from "zustand";
import type { OperationsFocus, OperationsSort } from "../matter/matter-interaction";

type MatterOverviewViewTransientState = {
  opsFocus: OperationsFocus;
  opsSort: OperationsSort;
  extrasOpen: boolean;
};

const transientDefaults: MatterOverviewViewTransientState = {
  opsFocus: "all",
  opsSort: "priority",
  extrasOpen: false,
};

export type MatterOverviewViewState = MatterOverviewViewTransientState & {
  setOpsFocus: (focus: OperationsFocus) => void;
  setOpsSort: (sort: OperationsSort) => void;
  openExtras: () => void;
  closeExtras: () => void;
  /** 面板重挂载时复位到初始视图，对齐原 useState 初始语义。 */
  resetTransient: () => void;
};

export const useMatterOverviewViewStore = create<MatterOverviewViewState>()((set) => ({
  ...transientDefaults,

  setOpsFocus: (focus) => set({ opsFocus: focus }),
  setOpsSort: (sort) => set({ opsSort: sort }),
  openExtras: () => set({ extrasOpen: true }),
  closeExtras: () => set({ extrasOpen: false }),
  resetTransient: () => set({ ...transientDefaults }),
}));

/** 测试用：回到模块初始状态。 */
export function resetMatterOverviewViewStoreForTest(): void {
  useMatterOverviewViewStore.setState({ ...transientDefaults });
}

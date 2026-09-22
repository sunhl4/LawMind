/**
 * 文书台面板可见性 — zustand 域 store。
 * 域边界：meta / editor / preview 三栏展开状态；仅被 header 与 ReviewWorkbench 消费。
 * 持久化在 localStorage，toggle 时禁止全部关闭（对齐原 root 行为）。
 */
import { create } from "zustand";
import {
  countVisibleReviewPanes,
  readReviewPaneVisibility,
  writeReviewPaneVisibility,
  type ReviewPaneId,
  type ReviewPaneVisibility,
} from "../lawmind-review-pane-prefs";

export type ReviewPaneVisibilityState = {
  visibility: ReviewPaneVisibility;
  setVisibility: (next: ReviewPaneVisibility) => void;
  togglePane: (id: ReviewPaneId) => void;
  resetForTest: () => void;
};

export const useReviewPaneVisibilityStore = create<ReviewPaneVisibilityState>()((set) => ({
  visibility: readReviewPaneVisibility(),

  setVisibility: (next) => {
    writeReviewPaneVisibility(next);
    set({ visibility: next });
  },

  togglePane: (id) => {
    set((state) => {
      const next = { ...state.visibility, [id]: !state.visibility[id] };
      if (countVisibleReviewPanes(next) === 0) {
        return state;
      }
      writeReviewPaneVisibility(next);
      return { visibility: next };
    });
  },

  resetForTest: () => {
    const next = readReviewPaneVisibility();
    set({ visibility: next });
  },
}));

/** 测试用：重读持久化初始状态。 */
export function resetReviewPaneVisibilityStoreForTest(): void {
  useReviewPaneVisibilityStore.setState({ visibility: readReviewPaneVisibility() });
}

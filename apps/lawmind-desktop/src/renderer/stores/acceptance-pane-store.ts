/**
 * 对话中栏：核对纸是否盖住文件。
 * 顶栏的编辑区开关和对话里的「打开核对」都读这里，避免纸和文件互相盖死后没有回路。
 */
import { create } from "zustand";

export type AcceptancePaneState = {
  covering: boolean;
  available: boolean;
  revealEditorNonce: number;
  openSheetNonce: number;
  setPane: (next: { covering: boolean; available: boolean }) => void;
  revealEditor: () => void;
  openSheet: () => void;
  resetForTest: () => void;
};

const initial = {
  covering: false,
  available: false,
  revealEditorNonce: 0,
  openSheetNonce: 0,
};

export const useAcceptancePaneStore = create<AcceptancePaneState>()((set) => ({
  ...initial,
  setPane: (next) => set(next),
  revealEditor: () => set((state) => ({ revealEditorNonce: state.revealEditorNonce + 1 })),
  openSheet: () => set((state) => ({ openSheetNonce: state.openSheetNonce + 1 })),
  resetForTest: () => set(initial),
}));

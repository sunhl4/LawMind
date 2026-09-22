/**
 * 设置面板导航状态 — zustand 域 store。
 * 域边界：设置面板开关、当前分区、滚动锚点。
 * 被 header / sidebar / 设置面板 / 各「打开设置 → 某分区」回调消费。
 *
 * 持久化：仅分区偏好读 localStorage；打开时未指定分区则回退到上次分区。
 */
import { create } from "zustand";
import {
  LAWMIND_SETTINGS_DEFAULT_SECTION,
  readStoredSettingsSection,
  type LawmindSettingsScrollAnchorId,
  type LawmindSettingsSectionId,
} from "../lawmind-settings-nav";

export type SetSettingsPanel = (
  open: boolean | ((prev: boolean) => boolean),
  sectionId?: LawmindSettingsSectionId,
  scrollAnchorId?: LawmindSettingsScrollAnchorId,
) => void;

type SettingsPanelState = {
  open: boolean;
  sectionId: LawmindSettingsSectionId;
  scrollAnchorId?: LawmindSettingsScrollAnchorId;

  setOpen: (open: boolean) => void;
  setSectionId: (sectionId: LawmindSettingsSectionId) => void;
  setScrollAnchorId: (scrollAnchorId?: LawmindSettingsScrollAnchorId) => void;
  setSettingsPanel: SetSettingsPanel;
  resetForTest: () => void;
};

export const useSettingsPanelStore = create<SettingsPanelState>()((set, _get) => ({
  open: false,
  sectionId: LAWMIND_SETTINGS_DEFAULT_SECTION,
  scrollAnchorId: undefined,

  setOpen: (open) => set({ open }),

  setSectionId: (sectionId) => set({ sectionId }),

  setScrollAnchorId: (scrollAnchorId) => set({ scrollAnchorId }),

  setSettingsPanel: (openArg, sectionId, scrollAnchorId) => {
    set((state) => {
      const nextOpen = typeof openArg === "function" ? openArg(state.open) : openArg;
      return {
        open: nextOpen,
        sectionId:
          sectionId ?? (nextOpen ? readStoredSettingsSection() : LAWMIND_SETTINGS_DEFAULT_SECTION),
        scrollAnchorId,
      };
    });
  },

  resetForTest: () =>
    set({ open: false, sectionId: LAWMIND_SETTINGS_DEFAULT_SECTION, scrollAnchorId: undefined }),
}));

/** 测试用：回到初始状态。 */
export function resetSettingsPanelStoreForTest(): void {
  useSettingsPanelStore.setState({
    open: false,
    sectionId: LAWMIND_SETTINGS_DEFAULT_SECTION,
    scrollAnchorId: undefined,
  });
}

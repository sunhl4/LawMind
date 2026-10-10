/**
 * 跨视图打开案件管理（对话意图 / 全局搜索 / 深链共用）。
 */

export const LAWMIND_OPEN_MATTER_ON_DESK = "lawmind:open-matter-on-desk";
/** 对话发出「查看/打开案件」类话术前抛出；根壳解析案名后打开中栏案件管理。 */
export const LAWMIND_VIEW_MATTER_INTENT = "lawmind:view-matter-intent";

export type OpenMatterOnDeskDetail = {
  matterId: string;
};

export type ViewMatterIntentDetail = {
  text: string;
  boundMatterId?: string | null;
};

export function requestOpenMatterOnDesk(matterId: string): void {
  const mid = matterId.trim();
  if (!mid || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<OpenMatterOnDeskDetail>(LAWMIND_OPEN_MATTER_ON_DESK, {
      detail: { matterId: mid },
    }),
  );
}

export function requestViewMatterFromChat(text: string, boundMatterId?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ViewMatterIntentDetail>(LAWMIND_VIEW_MATTER_INTENT, {
      detail: { text: trimmed, boundMatterId },
    }),
  );
}

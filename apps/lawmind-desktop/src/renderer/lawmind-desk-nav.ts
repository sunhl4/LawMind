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

/** 今日提醒「新建案件并挂上」：建案成功后把计划行挂上 matterId。 */
export type PendingAgendaMatterLink = {
  itemId: string;
  originDate?: string;
};

let pendingAgendaMatterLink: PendingAgendaMatterLink | null = null;

export function setPendingAgendaMatterLink(link: PendingAgendaMatterLink | null): void {
  pendingAgendaMatterLink = link;
}

export function takePendingAgendaMatterLink(): PendingAgendaMatterLink | null {
  const next = pendingAgendaMatterLink;
  pendingAgendaMatterLink = null;
  return next;
}

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

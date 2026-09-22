import { useMatterSessionTimelineQuery } from "../lawmind-query-hooks";

export type SessionTimelineEntry = {
  id: string;
  timestamp: string;
  label: string;
  severity: string;
};

/** @deprecated refreshVersion ignored — use query invalidation via lawmindQueryKeys */
export function useMatterSessionTimeline(
  apiBase: string,
  matterId: string | null,
  panelTab: string,
  _refreshVersion?: number,
): SessionTimelineEntry[] {
  const { data } = useMatterSessionTimelineQuery(apiBase, matterId, panelTab);
  return data ?? [];
}

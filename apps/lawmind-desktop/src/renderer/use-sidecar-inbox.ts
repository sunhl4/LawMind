import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeSidecarPending,
  fetchSidecarPending,
  type SidecarPendingItem,
} from "./lawmind-sidecar-inbox";

const POLL_MS = 4000;

export function useSidecarInbox(apiBase: string | undefined, enabled: boolean) {
  const [latest, setLatest] = useState<SidecarPendingItem | null>(null);

  const refresh = useCallback(async () => {
    if (!apiBase?.trim() || !enabled) {
      setLatest(null);
      return;
    }
    try {
      const items = await fetchSidecarPending(apiBase);
      setLatest(items[0] ?? null);
    } catch {
      // 桌面未就绪或旧服务没有 pending 路由时保持安静
    }
  }, [apiBase, enabled]);

  useEffect(() => {
    if (!apiBase?.trim() || !enabled) {
      setLatest(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [apiBase, enabled, refresh]);

  const ack = useCallback(
    async (relativePath: string) => {
      if (!apiBase?.trim()) {
        return;
      }
      await acknowledgeSidecarPending(apiBase, relativePath);
      setLatest((current) => (current?.relativePath === relativePath ? null : current));
    },
    [apiBase],
  );

  return { latest, refresh, ack };
}

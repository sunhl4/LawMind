/**
 * 审批请求全局订阅 hook。
 * 通过 SSE `approval:update` 与降级轮询保持待确认操作列表同步。
 */

import { useEffect, useRef } from "react";
import { useSseSubscription } from "./useSseSubscription";
import { useApprovalRequestStore, type ApprovalItem } from "./stores/approval-request-store";

export type UseApprovalRequestsResult = {
  items: ApprovalItem[];
  loading: boolean;
  error: string | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  approve: (item: ApprovalItem) => Promise<void>;
  reject: (item: ApprovalItem) => Promise<void>;
  requestMoreInfo: () => void;
  /** 用户可见的待处理总数。 */
  count: number;
};

export function useApprovalRequests(
  apiBase: string | undefined,
  matterId?: string | null,
): UseApprovalRequestsResult {
  const store = useApprovalRequestStore();
  // zustand store 引用稳定，但 effect 依赖数组中不应包含对象引用。
  // 使用 ref 保证闭包始终访问同一 store，避免依赖变化触发循环刷新。
  const storeRef = useRef(store);
  storeRef.current = store;
  const matterIdRef = useRef(matterId);
  matterIdRef.current = matterId;

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    void storeRef.current.refresh(apiBase, matterIdRef.current);
    // 只应在 apiBase/matterId 变化时刷新；store 对象本身稳定，不放入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, matterId]);

  const handleSseMessage = useRef(() => {
    if (apiBase) {
      void storeRef.current.refresh(apiBase, matterIdRef.current);
    }
  });
  handleSseMessage.current = () => {
    if (apiBase) {
      void storeRef.current.refresh(apiBase, matterIdRef.current);
    }
  };

  const { connected } = useSseSubscription(
    apiBase ?? null,
    ["approval:update"],
    () => {
      handleSseMessage.current();
    },
    { enabled: Boolean(apiBase) },
  );

  // SSE 未连接时按 8 秒间隔降级轮询。
  useEffect(() => {
    if (!apiBase || connected) {
      return;
    }
    const t = window.setInterval(() => void storeRef.current.refresh(apiBase, matterIdRef.current), 8_000);
    return () => window.clearInterval(t);
    // 只依赖 apiBase/connected；matterId 由 ref 保持最新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, connected]);

  return {
    items: store.items,
    loading: store.loading,
    error: store.error,
    open: store.open,
    setOpen: store.setOpen,
    refresh: () => storeRef.current.refresh(apiBase ?? "", matterIdRef.current),
    approve: (item) => storeRef.current.approve(apiBase ?? "", item),
    reject: (item) => storeRef.current.reject(apiBase ?? "", item),
    requestMoreInfo: store.requestMoreInfo,
    count: store.items.length,
  };
}

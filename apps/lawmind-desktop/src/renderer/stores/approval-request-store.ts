/**
 * 工具/案件操作确认状态——全局 zustand store。
 * 被 LawmindApprovalRequestHost 消费；SSE 订阅在 hook 层。
 * 「待我拍板」是侧栏进在办的唯一入口，不在此面板复用该词。
 *
 * 读 / 写都走 `/api/approvals`：角标 = 列表长度，避免和 action-summary
 * 的 requiresDecisionTotal（队列/外发/inbox）混成两套分类。
 */

import { create } from "zustand";
import { apiGetJson, apiSendJson } from "../api-client";
import { ApiRequestError, errorMessage } from "../api-client";

export type ApprovalItem = {
  id: string;
  kind: "tool_approval" | "matter_approval";
  title: string;
  summary: string;
  matterId?: string;
  sessionId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
  expiresAt: string;
  decisions: Array<"approve" | "reject" | "more_info">;
};

export type ApprovalRequestState = {
  items: ApprovalItem[];
  /** 与 items.length 相同：浮层只计数自己列出的审批。 */
  decisionTotal: number;
  loading: boolean;
  error: string | null;
  open: boolean;
  /** 上一次刷新时使用的 matterId，用于增量刷新。 */
  lastMatterId?: string;
  setOpen: (open: boolean) => void;
  refresh: (apiBase: string, matterId?: string | null) => Promise<void>;
  approve: (apiBase: string, item: ApprovalItem) => Promise<void>;
  reject: (apiBase: string, item: ApprovalItem) => Promise<void>;
  /** 需要更多信息：仅关闭面板，不解决审批，让用户回对话补充。 */
  requestMoreInfo: () => void;
  removeItem: (id: string) => void;
};

type ApprovalsListPayload = {
  ok?: boolean;
  items?: ApprovalItem[];
  decisionTotal?: number;
};

function isAlreadyResolved(e: unknown): boolean {
  return (
    e instanceof ApiRequestError &&
    e.status === 409 &&
    e.body?.code === "approval_already_resolved"
  );
}

export const useApprovalRequestStore = create<ApprovalRequestState>()((set, get) => ({
  items: [],
  decisionTotal: 0,
  loading: false,
  error: null,
  open: false,
  setOpen: (open) => set({ open }),

  refresh: async (apiBase, matterId) => {
    set({ loading: true, error: null, lastMatterId: matterId ?? undefined });
    try {
      const q = matterId ? `?matterId=${encodeURIComponent(matterId)}` : "";
      const payload = await apiGetJson<ApprovalsListPayload>(apiBase, `/api/approvals${q}`);
      const items = payload.items ?? [];
      set({ items, decisionTotal: items.length, loading: false });
    } catch (e) {
      set({ error: errorMessage(e, "刷新待确认失败"), loading: false });
    }
  },

  approve: async (apiBase, item) => {
    try {
      await apiSendJson(apiBase, `/api/approvals/${encodeURIComponent(item.id)}/approve`, "POST");
      get().removeItem(item.id);
    } catch (e) {
      if (isAlreadyResolved(e)) {
        get().removeItem(item.id);
        void get().refresh(apiBase, get().lastMatterId);
        return;
      }
      set({ error: errorMessage(e, "批准失败") });
    }
  },

  reject: async (apiBase, item) => {
    try {
      await apiSendJson(apiBase, `/api/approvals/${encodeURIComponent(item.id)}/reject`, "POST");
      get().removeItem(item.id);
    } catch (e) {
      if (isAlreadyResolved(e)) {
        get().removeItem(item.id);
        void get().refresh(apiBase, get().lastMatterId);
        return;
      }
      set({ error: errorMessage(e, "拒绝失败") });
    }
  },

  requestMoreInfo: () => {
    set({ open: false, error: null });
  },

  removeItem: (id) => {
    set((state) => {
      const items = state.items.filter((i) => i.id !== id);
      return { items, decisionTotal: items.length };
    });
  },
}));

export function resetApprovalRequestStoreForTest(): void {
  useApprovalRequestStore.setState({
    items: [],
    decisionTotal: 0,
    loading: false,
    error: null,
    open: false,
    lastMatterId: undefined,
  });
}

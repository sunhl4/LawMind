import { useState } from "react";
import { useMatterWorkspaceAcceptanceQuery, type MatterWorkspaceAcceptance } from "../lawmind-query-hooks";

export type { MatterWorkspaceAcceptance };

export function useMatterWorkspaceAcceptance(
  apiBase: string,
  enabled: boolean,
  _refreshVersion?: number,
): {
  workspaceAcceptance: MatterWorkspaceAcceptance | null;
  workspaceAcceptanceErr: string | null;
  reload: () => Promise<void>;
} {
  const q = useMatterWorkspaceAcceptanceQuery(apiBase, enabled);
  return {
    workspaceAcceptance: q.data ?? null,
    workspaceAcceptanceErr: q.error
      ? q.error instanceof Error
        ? q.error.message
        : "加载失败"
      : null,
    reload: async () => {
      await q.refetch();
    },
  };
}

export type MatterPanelTab =
  | "overview"
  | "case"
  | "tasks"
  | "matrix"
  | "timeline"
  | "cognition"
  | "meeting"
  | "ledger"
  | "deliveries";

export function useMatterPanelTab(
  initial: MatterPanelTab = "overview",
): [MatterPanelTab, (tab: MatterPanelTab) => void] {
  return useState<MatterPanelTab>(initial);
}

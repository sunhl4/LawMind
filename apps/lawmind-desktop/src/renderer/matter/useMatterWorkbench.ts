import { useCallback, useEffect, useState } from "react";
import { apiGetJson, errorMessage, messageFromOkFalseBody } from "../api-client";
import type { AcceptanceSummaryItem } from "./matter-acceptance-display";

export type MatterWorkspaceAcceptance = {
  count: number;
  readyCount: number;
  blockedCount: number;
  items: AcceptanceSummaryItem[];
};

export function useMatterWorkspaceAcceptance(
  apiBase: string,
  enabled: boolean,
  refreshVersion: number,
): {
  workspaceAcceptance: MatterWorkspaceAcceptance | null;
  workspaceAcceptanceErr: string | null;
  reload: () => Promise<void>;
} {
  const [workspaceAcceptance, setWorkspaceAcceptance] = useState<MatterWorkspaceAcceptance | null>(
    null,
  );
  const [workspaceAcceptanceErr, setWorkspaceAcceptanceErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setWorkspaceAcceptanceErr(null);
    try {
      const j = await apiGetJson<{
        ok?: boolean;
        count?: number;
        readyCount?: number;
        blockedCount?: number;
        items?: AcceptanceSummaryItem[];
      }>(apiBase, "/api/acceptance-summary");
      if (!j.ok || !Array.isArray(j.items)) {
        throw new Error(messageFromOkFalseBody(j, "加载工作区验收概览失败"));
      }
      setWorkspaceAcceptance({
        count: j.count ?? j.items.length,
        readyCount: j.readyCount ?? 0,
        blockedCount: j.blockedCount ?? 0,
        items: j.items,
      });
    } catch (e) {
      setWorkspaceAcceptanceErr(errorMessage(e, "加载工作区验收概览失败"));
      setWorkspaceAcceptance(null);
    }
  }, [apiBase, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void reload();
  }, [apiBase, enabled, refreshVersion, reload]);

  return { workspaceAcceptance, workspaceAcceptanceErr, reload };
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

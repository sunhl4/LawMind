import { useCallback, useEffect, useState } from "react";
import { apiGetJson } from "./api-client";
import { useActionSummaryQuery } from "./lawmind-query-hooks";
import {
  readComposePermissionMode,
  writeComposePermissionMode,
  type ComposePermissionMode,
} from "./lawmind-compose-prefs";

export type LawmindComposeExtras = ReturnType<typeof useLawmindComposeExtras>;

/**
 * Compose chrome extras. Action-summary is shared with the shell React Query
 * cache (workspace-wide) so sticky review / badges stay in sync without a
 * second 5s poller.
 */
export function useLawmindComposeExtras(opts: {
  apiBase?: string;
  sessionId?: string;
  matterId?: string | null;
}) {
  const [permissionMode, setPermissionMode] = useState<ComposePermissionMode>(() =>
    readComposePermissionMode(),
  );
  const [contextBudget, setContextBudget] = useState<{
    used: number;
    effectiveLimit: number;
    level: string;
  } | null>(null);

  // Workspace-wide summary (not scoped to compose matter) — sticky CTA needs all pending drafts.
  const summaryQuery = useActionSummaryQuery(opts.apiBase ?? null, null, Boolean(opts.apiBase));
  const actionSummary = summaryQuery.data ?? null;
  const pendingApprovalCount =
    actionSummary?.pendingToolApprovals ?? actionSummary?.toolApprovals?.length ?? 0;

  const refreshPending = useCallback(async () => {
    await summaryQuery.refetch();
  }, [summaryQuery.refetch]);

  const refreshContextBudget = useCallback(async () => {
    if (!opts.apiBase || !opts.sessionId) {
      setContextBudget(null);
      return;
    }
    try {
      const b = await apiGetJson<{
        ok: boolean;
        used: number;
        effectiveLimit: number;
        level: string;
      }>(opts.apiBase, `/api/sessions/${encodeURIComponent(opts.sessionId)}/context-budget`);
      setContextBudget({ used: b.used, effectiveLimit: b.effectiveLimit, level: b.level });
    } catch {
      setContextBudget(null);
    }
  }, [opts.apiBase, opts.sessionId]);

  useEffect(() => {
    void refreshContextBudget();
  }, [refreshContextBudget]);

  const onPermissionModeChange = useCallback((mode: ComposePermissionMode) => {
    setPermissionMode(mode);
    writeComposePermissionMode(mode);
  }, []);

  const applyStreamTokenBudget = useCallback(
    (info: { used: number; effectiveLimit: number; level: string }) => {
      setContextBudget({
        used: info.used,
        effectiveLimit: info.effectiveLimit,
        level: info.level,
      });
    },
    [],
  );

  return {
    permissionMode,
    onPermissionModeChange,
    pendingApprovalCount,
    actionSummary,
    refreshPending,
    contextBudget,
    refreshContextBudget,
    applyStreamTokenBudget,
  };
}

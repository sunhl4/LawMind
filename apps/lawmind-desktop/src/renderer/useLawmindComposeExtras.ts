import { useCallback, useEffect, useState } from "react";
import { apiGetJson } from "./api-client";
import {
  readComposePermissionMode,
  writeComposePermissionMode,
  type ComposePermissionMode,
} from "./lawmind-compose-prefs";

export type LawmindComposeExtras = ReturnType<typeof useLawmindComposeExtras>;

export function useLawmindComposeExtras(opts: {
  apiBase?: string;
  sessionId?: string;
  matterId?: string | null;
}) {
  const [permissionMode, setPermissionMode] = useState<ComposePermissionMode>(() =>
    readComposePermissionMode(),
  );
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [contextBudget, setContextBudget] = useState<{
    used: number;
    effectiveLimit: number;
    level: string;
  } | null>(null);

  const refreshPending = useCallback(async () => {
    if (!opts.apiBase) {
      return;
    }
    const q = opts.matterId ? `?matterId=${encodeURIComponent(opts.matterId)}` : "";
    try {
      const s = await apiGetJson<{ ok: boolean; toolApprovals?: unknown[] }>(
        opts.apiBase,
        `/api/action-summary${q}`,
      );
      setPendingApprovalCount(s.toolApprovals?.length ?? 0);
    } catch {
      setPendingApprovalCount(0);
    }
  }, [opts.apiBase, opts.matterId]);

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
    void refreshPending();
    const t = window.setInterval(() => void refreshPending(), 12_000);
    return () => window.clearInterval(t);
  }, [refreshPending]);

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
    refreshPending,
    contextBudget,
    refreshContextBudget,
    applyStreamTokenBudget,
  };
}

// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import { useCallback, useEffect, useState } from "react";
import { apiGetJson, apiSendJson } from "./api-client";
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
  /** Called after compact returns updated messages (reload transcript). */
  onCompactMessages?: (
    messages: Array<{ role: string; text?: string; content?: string }>,
  ) => void;
}) {
  const [permissionMode, setPermissionMode] = useState<ComposePermissionMode>(() =>
    readComposePermissionMode(),
  );
  const [contextBudget, setContextBudget] = useState<{
    used: number;
    effectiveLimit: number;
    level: string;
  } | null>(null);
  const [compactBusy, setCompactBusy] = useState(false);
  const [compactHint, setCompactHint] = useState<string | null>(null);

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

  // 首跑 / 设置页可能改写 localStorage；随案件切换时重新同步。
  useEffect(() => {
    setPermissionMode(readComposePermissionMode());
  }, [opts.matterId]);

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

  const previewCompact = useCallback(async () => {
    if (!opts.apiBase || !opts.sessionId) {
      return null;
    }
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          dryRun?: boolean;
          compacted?: boolean;
          droppedMessageCount?: number;
          estimatedDroppedTokens?: number;
          useLlmDigestAvailable?: boolean;
          useLlmDigest?: boolean;
          error?: string;
        },
        { dryRun: boolean; useLlmDigest?: boolean }
      >(opts.apiBase, `/api/sessions/${encodeURIComponent(opts.sessionId)}/compact`, "POST", {
        dryRun: true,
        useLlmDigest: true,
      });
      if (!j.ok) {
        throw new Error(j.error ?? "预览失败");
      }
      return {
        compacted: j.compacted === true,
        droppedMessageCount: j.droppedMessageCount ?? 0,
        estimatedDroppedTokens: j.estimatedDroppedTokens ?? 0,
        useLlmDigestAvailable: j.useLlmDigestAvailable === true,
        useLlmDigest: j.useLlmDigest !== false,
      };
    } catch {
      return null;
    }
  }, [opts.apiBase, opts.sessionId]);

  const runCompact = useCallback(
    async (opts2?: { distill?: boolean; useLlmDigest?: boolean }) => {
      if (!opts.apiBase || !opts.sessionId) {
        return;
      }
      setCompactBusy(true);
      setCompactHint(null);
      try {
        const j = await apiSendJson<
          {
            ok?: boolean;
            compacted?: boolean;
            droppedMessageCount?: number;
            usedLlmDigest?: boolean;
            error?: string;
            messages?: Array<{ role: string; text?: string; content?: string }>;
            distill?: {
              suggestionIds?: string[];
              preferenceSnippetCount?: number;
              sessionSummaryAppended?: boolean;
            };
          },
          { distill?: boolean; useLlmDigest?: boolean }
        >(opts.apiBase, `/api/sessions/${encodeURIComponent(opts.sessionId)}/compact`, "POST", {
          distill: opts2?.distill === true,
          useLlmDigest: opts2?.useLlmDigest !== false,
        });
        if (!j.ok) {
          throw new Error(j.error ?? "整理失败");
        }
        if (Array.isArray(j.messages)) {
          opts.onCompactMessages?.(j.messages);
        }
        const distillBits: string[] = [];
        if (j.distill?.preferenceSnippetCount && j.distill.preferenceSnippetCount > 0) {
          distillBits.push(`偏好建议 ${j.distill.preferenceSnippetCount} 条`);
        }
        if (j.distill?.suggestionIds?.length) {
          distillBits.push("待记忆检查采纳");
        }
        const distillHint = distillBits.length > 0 ? ` · ${distillBits.join(" · ")}` : "";
        const llmHint = j.usedLlmDigest ? " · 已智能摘要" : "";
        setCompactHint(
          j.compacted
            ? `已整理上下文${typeof j.droppedMessageCount === "number" ? `（压缩 ${j.droppedMessageCount} 条）` : ""}${llmHint}${distillHint}`
            : opts2?.distill
              ? distillHint
                ? `已沉淀学习${distillHint}`
                : "未识别到可沉淀的偏好/摘要"
              : "当前无需压缩",
        );
        await refreshContextBudget();
      } catch (e) {
        setCompactHint(e instanceof Error ? e.message : "整理失败");
      } finally {
        setCompactBusy(false);
      }
    },
    [opts.apiBase, opts.onCompactMessages, opts.sessionId, refreshContextBudget],
  );

  const compactSession = useCallback(async () => {
    await runCompact({ distill: false });
  }, [runCompact]);

  const distillSessionLearning = useCallback(async () => {
    await runCompact({ distill: true });
  }, [runCompact]);

  return {
    permissionMode,
    onPermissionModeChange,
    pendingApprovalCount,
    actionSummary,
    refreshPending,
    contextBudget,
    refreshContextBudget,
    applyStreamTokenBudget,
    previewCompact,
    runCompact,
    compactSession,
    distillSessionLearning,
    compactBusy,
    compactHint,
  };
}

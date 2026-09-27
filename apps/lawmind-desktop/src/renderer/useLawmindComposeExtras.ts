// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import { useCallback, useEffect, useState } from "react";
import { apiGetJson, apiSendJson } from "./api-client";
import { useActionSummaryQuery } from "./lawmind-query-hooks";
import {
  readComposePermissionMode,
  writeComposePermissionMode,
  type ComposePermissionMode,
} from "./lawmind-compose-prefs";
import type {
  ComposeContextBreakdownBucket,
  ComposeContextBudget,
  ComposeContextWindow,
  ComposeLastCompact,
} from "./LawmindComposeContextUsage";

export type ComposeForkResult =
  | {
      ok: true;
      sessionId: string;
      title?: string;
      reused?: boolean;
      digestSource?: "llm" | "extractive" | "none";
      stats?: { droppedMessageCount: number; digestChars: number; seedChars: number };
    }
  | {
      ok: false;
      code: "source_not_found" | "turn_live" | "pending_authorization";
      message: string;
      blockingActions?: string[];
    };

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
  /**
   * compose 里选中的模型。上下文用量的分母必须跟它走：请求体（`/api/chat`）带的是
   * 同一个 modelId，两者不一致时圆环会显示错误的窗口与阈值。
   */
  modelId?: string;
  /** Called after compact returns updated messages (reload transcript). */
  onCompactMessages?: (
    messages: Array<{ role: string; text?: string; content?: string }>,
  ) => void;
}) {
  const [permissionMode, setPermissionMode] = useState<ComposePermissionMode>(() =>
    readComposePermissionMode(),
  );
  const [contextBudget, setContextBudget] = useState<ComposeContextBudget | null>(null);
  const [compactBusy, setCompactBusy] = useState(false);
  const [compactHint, setCompactHint] = useState<string | null>(null);
  const [forkBusy, setForkBusy] = useState(false);

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
      const query = opts.modelId?.trim()
        ? `?modelId=${encodeURIComponent(opts.modelId.trim())}`
        : "";
      const b = await apiGetJson<{
        ok: boolean;
        used: number;
        effectiveLimit: number;
        level: string;
        modelId?: string;
        breakdown?: { buckets?: ComposeContextBreakdownBucket[]; total?: number };
        window?: ComposeContextWindow;
        compactCount?: number;
        lastCompact?: ComposeLastCompact | null;
        tuning?: { carryover?: { suggestMinCompacts?: number } };
      }>(
        opts.apiBase,
        `/api/sessions/${encodeURIComponent(opts.sessionId)}/context-budget${query}`,
      );
      setContextBudget({
        used: b.used,
        effectiveLimit: b.effectiveLimit,
        level: b.level,
        modelId: typeof b.modelId === "string" ? b.modelId : undefined,
        breakdown: Array.isArray(b.breakdown?.buckets) ? b.breakdown.buckets : undefined,
        window: b.window,
        compactCount: typeof b.compactCount === "number" ? b.compactCount : undefined,
        lastCompact: b.lastCompact ?? null,
        suggestMinCompacts:
          typeof b.tuning?.carryover?.suggestMinCompacts === "number"
            ? b.tuning.carryover.suggestMinCompacts
            : undefined,
      });
    } catch {
      setContextBudget(null);
    }
  }, [opts.apiBase, opts.modelId, opts.sessionId]);

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
      // 流内只更新水位；分层与窗口三元组保持上一次 HTTP 结果（下一轮开始时会整体刷新）。
      setContextBudget((prev) =>
        prev
          ? { ...prev, used: info.used, effectiveLimit: info.effectiveLimit, level: info.level }
          : { used: info.used, effectiveLimit: info.effectiveLimit, level: info.level },
      );
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
          distillBits.push("请到记忆里确认");
        }
        const distillHint = distillBits.length > 0 ? ` · ${distillBits.join(" · ")}` : "";
        setCompactHint(
          j.compacted
            ? `这场对话已整理${typeof j.droppedMessageCount === "number" ? `（收起较早的 ${j.droppedMessageCount} 条来回）` : ""}${distillHint}`
            : opts2?.distill
              ? distillHint
                ? `已交给你确认${distillHint}`
                : "这次没有可记住的习惯"
              : "这场对话还不需要整理",
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

  /**
   * 另起新对话并带上文（见 `src/lawmind/agent/session-carryover.ts`）。
   * `clientNonce` 由调用方给并复用，重复点击只会复用一个新会话，不会造第二份。
   */
  const forkWithCarryover = useCallback(
    async (input?: { clientNonce?: string; title?: string }): Promise<ComposeForkResult> => {
      if (!opts.apiBase || !opts.sessionId) {
        return { ok: false, code: "source_not_found", message: "当前没有可续接的对话。" };
      }
      setForkBusy(true);
      try {
        const j = await apiSendJson<
          {
            ok?: boolean;
            code?: string;
            message?: string;
            blockingActions?: string[];
            sessionId?: string;
            title?: string;
            reused?: boolean;
            digestSource?: "llm" | "extractive" | "none";
            stats?: { droppedMessageCount: number; digestChars: number; seedChars: number };
          },
          { clientNonce?: string; title?: string; useLlmDigest?: boolean }
        >(
          opts.apiBase,
          `/api/sessions/${encodeURIComponent(opts.sessionId)}/fork-with-carryover`,
          "POST",
          {
            ...(input?.clientNonce ? { clientNonce: input.clientNonce } : {}),
            ...(input?.title ? { title: input.title } : {}),
          },
        );
        if (j.ok !== true || typeof j.sessionId !== "string") {
          const code = j.code === "turn_live" || j.code === "pending_authorization"
            ? j.code
            : "source_not_found";
          return {
            ok: false,
            code,
            message: typeof j.message === "string" ? j.message : "另起新对话失败。",
            ...(Array.isArray(j.blockingActions) ? { blockingActions: j.blockingActions } : {}),
          };
        }
        return {
          ok: true,
          sessionId: j.sessionId,
          ...(typeof j.title === "string" ? { title: j.title } : {}),
          reused: j.reused === true,
          ...(j.digestSource ? { digestSource: j.digestSource } : {}),
          ...(j.stats ? { stats: j.stats } : {}),
        };
      } catch (e) {
        return {
          ok: false,
          code: "source_not_found",
          message: e instanceof Error ? e.message : "另起新对话失败。",
        };
      } finally {
        setForkBusy(false);
      }
    },
    [opts.apiBase, opts.sessionId],
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
    previewCompact,
    runCompact,
    compactSession,
    distillSessionLearning,
    compactBusy,
    compactHint,
    forkBusy,
    forkWithCarryover,
  };
}

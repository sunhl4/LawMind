// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type {
  AcceptanceReport,
  ReasoningReport,
} from "../../../../../src/lawmind/deliverables/types.ts";
import type { DraftScaffoldView } from "../../../../../src/lawmind/deliverables/scaffold-status.ts";
import type { ClauseGraph } from "../../../../../src/lawmind/reasoning/clause-graph.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GuardianLawyerView } from "../../../../../src/lawmind/guardian/types.ts";
import type { GateDecision, TaskExecutionState } from "../../../../../src/lawmind/platform/contracts.ts";
import { deriveReviewGateDecisions } from "../../../../../src/lawmind/platform/review-gates.ts";
import type { MemorySourceLayer } from "../../../../../src/lawmind/memory/memory-source-types.ts";
import {
  useInvalidateLawmindQueries,
  useReviewDraftDetailQuery,
  useReviewDraftListQuery,
} from "../lawmind-query-hooks";
import { lawmindQueryKeys } from "../lawmind-query-keys";
import { errorMessage } from "../api-client";

export type UseReviewWorkbenchDataParams = {
  apiBase: string;
  initialTaskId?: string | null;
  initialMatterId?: string | null;
  initialStatusFilter?: ArtifactDraft["reviewStatus"] | "all";
  initialListMode?: "pending" | "all";
  externalRefreshToken?: number;
  onRecordsChanged?: () => void;
  onExternalRefreshMessage?: (message: string) => void;
  /** 律师正在改正文/签批/导出时返回 true：轮询到的服务端快照先不覆盖详情。 */
  shouldHoldDetailRefresh?: () => boolean;
};

/**
 * 草稿台跟盘轮询：对话在另一个窗口改完草稿后，独立窗里的审核台要自己醒过来。
 * 只打本机回环的 `/api/drafts`；指纹没变时不动详情，避免每轮把编辑器值重置。
 */
export const REVIEW_WORKBENCH_LIVE_POLL_MS = 2_500;

/**
 * 草稿内容指纹：只取审核台会展示的字段。
 *
 * 不序列化整个对象 —— 列表接口和详情接口可能附带不同的派生字段，
 * 那会造成「内容没变但每轮都重拉详情」，把编辑器光标冲掉。
 */
export function reviewDraftFingerprint(draft: ArtifactDraft): string {
  return JSON.stringify([
    draft.title,
    draft.summary,
    draft.sections,
    draft.reviewNotes,
    draft.reviewStatus,
    draft.output,
    draft.outputPath ?? "",
    draft.contractEdit ?? null,
    draft.clarificationQuestions ?? [],
    draft.acceptanceCriteria ?? [],
  ]);
}

export function useReviewWorkbenchData(params: UseReviewWorkbenchDataParams) {
  const {
    apiBase,
    initialTaskId = null,
    initialMatterId = null,
    initialStatusFilter = "all",
    initialListMode = "pending",
    externalRefreshToken = 0,
    onRecordsChanged,
    onExternalRefreshMessage,
    shouldHoldDetailRefresh,
  } = params;

  const queryClient = useQueryClient();
  const { invalidateReview } = useInvalidateLawmindQueries();
  const revisionPrefilledForTaskRef = useRef<string | null>(null);

  const [filter, setFilter] = useState<"pending" | "all">(() => initialListMode);
  const [statusFilter, setStatusFilter] = useState<ArtifactDraft["reviewStatus"] | "all">(
    () => initialStatusFilter,
  );
  const [matterFilter, setMatterFilter] = useState(() => (initialMatterId ?? "").trim());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => initialTaskId);

  /** Avoid re-applying deep-link defaults on unrelated parent re-renders (would yank lawyer off「全部」). */
  const appliedFocusKeyRef = useRef<string | null>(null);

  const listQuery = useReviewDraftListQuery(apiBase);
  const detailQuery = useReviewDraftDetailQuery(apiBase, selectedTaskId);

  /** 轮询只读 ref：查询结果对象每轮渲染都会换，直接进依赖会把 interval 重装。 */
  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;
  const listRefetchRef = useRef(listQuery.refetch);
  listRefetchRef.current = listQuery.refetch;
  const detailRefetchRef = useRef(detailQuery.refetch);
  detailRefetchRef.current = detailQuery.refetch;
  const holdDetailRefreshRef = useRef(shouldHoldDetailRefresh);
  holdDetailRefreshRef.current = shouldHoldDetailRefresh;
  /** 当前正在显示的详情；轮询拿列表和它比，列表更新了才重拉详情。 */
  const detailDraftRef = useRef<ArtifactDraft | null>(null);

  /**
   * 跟盘：只在本机回环重拉草稿列表，和「当前显示的详情」比指纹，变了才重拉详情。
   *
   * 主窗口和独立窗都跑 —— 这样「对话在 A 窗、草稿台在 B 窗」两个方向都能醒。
   * 律师正在改正文/签批/导出时保留手上的内容，下一轮再试。
   */
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const taskId = selectedTaskIdRef.current?.trim();
      if (!taskId) {
        return;
      }
      const shown = detailDraftRef.current;
      if (!shown || shown.taskId !== taskId) {
        // 详情还没到 / 正切到另一份：下一轮再比。
        return;
      }
      inFlight = true;
      try {
        const result = await listRefetchRef.current();
        if (cancelled) {
          return;
        }
        const selected = (result.data ?? []).find((draft) => draft.taskId === taskId);
        if (!selected) {
          return;
        }
        if (reviewDraftFingerprint(selected) === reviewDraftFingerprint(shown)) {
          return;
        }
        if (holdDetailRefreshRef.current?.()) {
          return;
        }
        await detailRefetchRef.current();
      } catch {
        /* 瞬时失败留给下一轮；不要把审核台顶到错误态 */
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, REVIEW_WORKBENCH_LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const drafts = listQuery.data ?? [];
  const loading = listQuery.isLoading;
  const error = listQuery.error
    ? errorMessage(listQuery.error, "加载草稿列表失败")
    : null;
  const detailLoading = detailQuery.isLoading;

  const detail = detailQuery.data?.draft ?? null;
  detailDraftRef.current = detail;
  const citationIntegrity = detailQuery.data?.citationIntegrity ?? null;
  const guardian = detailQuery.data?.guardian ?? null;
  const memorySources = detailQuery.data?.memorySources ?? null;
  const acceptance = detailQuery.data?.acceptance ?? null;
  const reasoningReport = detailQuery.data?.reasoningReport ?? null;
  const reasoningMarkdown = detailQuery.data?.reasoningMarkdown ?? null;
  const executionState = detailQuery.data?.executionState ?? null;
  const clauses = detailQuery.data?.clauses ?? null;
  const scaffold = detailQuery.data?.scaffold ?? null;

  const gateDecisions = useMemo((): GateDecision[] => {
    if (!detailQuery.data) {
      return [];
    }
    const apiGates = detailQuery.data.gateDecisions;
    if (Array.isArray(apiGates) && apiGates.length > 0) {
      return apiGates;
    }
    return deriveReviewGateDecisions(
      detailQuery.data.draft,
      detailQuery.data.acceptance ?? undefined,
    );
  }, [detailQuery.data]);

  const filtered = useMemo(() => {
    return drafts.filter((draft) => {
      const st = draft.reviewStatus ?? "pending";
      if (filter === "pending" && st !== "pending") {
        return false;
      }
      if (statusFilter !== "all" && st !== statusFilter) {
        return false;
      }
      if (matterFilter.trim() && draft.matterId !== matterFilter.trim()) {
        return false;
      }
      return true;
    });
  }, [drafts, filter, matterFilter, statusFilter]);

  const loadDrafts = useCallback(
    async (_opts?: { silent?: boolean }) => {
      await listQuery.refetch();
    },
    [listQuery],
  );

  const loadDetail = useCallback(
    async (taskId: string, _opts?: { preserveContent?: boolean }) => {
      await queryClient.invalidateQueries({
        queryKey: lawmindQueryKeys.reviewDraftDetail(apiBase, taskId),
      });
      if (taskId === selectedTaskId) {
        await detailQuery.refetch();
      }
    },
    [apiBase, detailQuery, queryClient, selectedTaskId],
  );

  const patchDetailCache = useCallback(
    (taskId: string, patch: Partial<NonNullable<typeof detailQuery.data>>) => {
      queryClient.setQueryData(lawmindQueryKeys.reviewDraftDetail(apiBase, taskId), (prev) => {
        if (!prev) {
          return prev;
        }
        return { ...prev, ...patch };
      });
    },
    [apiBase, queryClient],
  );

  const applyDetailFromResponse = useCallback(
    (
      taskId: string,
      j: {
        draft?: ArtifactDraft;
        citationIntegrity?: DraftCitationIntegrityView;
        guardian?: GuardianLawyerView | null;
        acceptance?: AcceptanceReport;
        reasoningReport?: ReasoningReport;
        reasoningMarkdown?: string | null;
        executionState?: TaskExecutionState;
        gateDecisions?: GateDecision[];
        memorySources?: MemorySourceLayer[];
        clauses?: ClauseGraph | null;
        scaffold?: DraftScaffoldView | null;
      },
    ) => {
      if (!j.draft) {
        return;
      }
      const gates =
        Array.isArray(j.gateDecisions) && j.gateDecisions.length > 0
          ? j.gateDecisions
          : deriveReviewGateDecisions(j.draft, j.acceptance ?? undefined);
      patchDetailCache(taskId, {
        draft: j.draft,
        citationIntegrity: j.citationIntegrity ?? null,
        guardian: j.guardian ?? null,
        acceptance: j.acceptance ?? null,
        reasoningReport: j.reasoningReport ?? null,
        reasoningMarkdown:
          typeof j.reasoningMarkdown === "string" && j.reasoningMarkdown.trim()
            ? j.reasoningMarkdown
            : null,
        executionState: j.executionState ?? null,
        gateDecisions: gates,
        memorySources: Array.isArray(j.memorySources) ? j.memorySources : null,
        clauses: j.clauses ?? null,
        scaffold: j.scaffold ?? null,
      });
    },
    [patchDetailCache],
  );

  useEffect(() => {
    const key = [
      initialTaskId ?? "",
      initialListMode,
      initialMatterId ?? "",
      initialStatusFilter,
    ].join("|");
    if (appliedFocusKeyRef.current === key) {
      return;
    }
    appliedFocusKeyRef.current = key;
    if (initialTaskId) {
      setSelectedTaskId(initialTaskId);
    }
    setMatterFilter(initialMatterId ?? "");
    setStatusFilter(initialStatusFilter);
    setFilter(initialListMode);
  }, [initialTaskId, initialListMode, initialMatterId, initialStatusFilter]);

  useEffect(() => {
    if (!externalRefreshToken) {
      return;
    }
    // Revision complete: return to pending inbox — intentional yank.
    appliedFocusKeyRef.current = null;
    setFilter("pending");
    setStatusFilter("all");
    revisionPrefilledForTaskRef.current = null;
    void (async () => {
      await loadDrafts({ silent: true });
      const taskId = (initialTaskId ?? selectedTaskId)?.trim();
      if (taskId) {
        await loadDetail(taskId, { preserveContent: true });
        onExternalRefreshMessage?.(
          "助手已完成修订，草稿已恢复为「待审核」。请在文档正文区查看并再次签批。",
        );
      }
      onRecordsChanged?.();
    })();
  }, [
    externalRefreshToken,
    initialTaskId,
    loadDetail,
    loadDrafts,
    onExternalRefreshMessage,
    onRecordsChanged,
    selectedTaskId,
  ]);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (initialTaskId?.trim() && !selectedTaskId) {
      return;
    }
    if (selectedTaskId && filtered.some((d) => d.taskId === selectedTaskId)) {
      return;
    }
    const first = filtered[0];
    if (first) {
      setSelectedTaskId(first.taskId);
    }
  }, [filtered, initialTaskId, loading, selectedTaskId]);

  const invalidateAllReview = useCallback(async () => {
    await invalidateReview(apiBase);
  }, [apiBase, invalidateReview]);

  return {
    drafts,
    loading,
    error,
    filter,
    setFilter,
    statusFilter,
    setStatusFilter,
    matterFilter,
    setMatterFilter,
    selectedTaskId,
    setSelectedTaskId,
    detail,
    citationIntegrity,
    guardian,
    memorySources,
    acceptance,
    reasoningReport,
    reasoningMarkdown,
    executionState,
    clauses,
    scaffold,
    gateDecisions,
    detailLoading,
    detailError: detailQuery.error
      ? errorMessage(detailQuery.error, "加载草稿失败")
      : null,
    filtered,
    loadDrafts,
    loadDetail,
    applyDetailFromResponse,
    invalidateAllReview,
    revisionPrefilledForTaskRef,
  };
}

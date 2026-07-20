import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type {
  AcceptanceReport,
  ReasoningReport,
} from "../../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision, TaskExecutionState } from "../../../../../src/lawmind/platform/contracts.ts";
import { deriveReviewGateDecisions } from "../../../../../src/lawmind/platform/review-gates.ts";
import type { MemorySourceLayer } from "../../../../../src/lawmind/memory/index.ts";
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
};

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

  const listQuery = useReviewDraftListQuery(apiBase);
  const detailQuery = useReviewDraftDetailQuery(apiBase, selectedTaskId);

  const drafts = listQuery.data ?? [];
  const loading = listQuery.isLoading;
  const error = listQuery.error
    ? errorMessage(listQuery.error, "加载草稿列表失败")
    : null;
  const detailLoading = detailQuery.isLoading;

  const detail = detailQuery.data?.draft ?? null;
  const citationIntegrity = detailQuery.data?.citationIntegrity ?? null;
  const memorySources = detailQuery.data?.memorySources ?? null;
  const acceptance = detailQuery.data?.acceptance ?? null;
  const reasoningReport = detailQuery.data?.reasoningReport ?? null;
  const reasoningMarkdown = detailQuery.data?.reasoningMarkdown ?? null;
  const executionState = detailQuery.data?.executionState ?? null;

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
        acceptance?: AcceptanceReport;
        reasoningReport?: ReasoningReport;
        reasoningMarkdown?: string | null;
        executionState?: TaskExecutionState;
        gateDecisions?: GateDecision[];
        memorySources?: MemorySourceLayer[];
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
        acceptance: j.acceptance ?? null,
        reasoningReport: j.reasoningReport ?? null,
        reasoningMarkdown:
          typeof j.reasoningMarkdown === "string" && j.reasoningMarkdown.trim()
            ? j.reasoningMarkdown
            : null,
        executionState: j.executionState ?? null,
        gateDecisions: gates,
        memorySources: Array.isArray(j.memorySources) ? j.memorySources : null,
      });
    },
    [patchDetailCache],
  );

  useEffect(() => {
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
    setFilter("pending");
    setStatusFilter("pending");
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
    memorySources,
    acceptance,
    reasoningReport,
    reasoningMarkdown,
    executionState,
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

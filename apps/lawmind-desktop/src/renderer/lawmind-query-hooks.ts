import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGetJson, messageFromOkFalseBody } from "./api-client";
import type { HealthPayload } from "./lawmind-app-data";
import { loadActionSummary } from "./lawmind-requires-action";
import { lawmindQueryKeys } from "./lawmind-query-keys";
import type { SessionTimelineEntry } from "./matter/useMatterSessionTimeline";
import type { AcceptanceSummaryItem } from "./matter/matter-acceptance-display";
import type { ArtifactDraft, MatterOverview } from "../../../../src/lawmind/types.ts";
import type { AcceptanceReport, ReasoningReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision, TaskExecutionState } from "../../../../src/lawmind/platform/contracts.ts";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";

export type MatterWorkspaceAcceptance = {
  count: number;
  readyCount: number;
  blockedCount: number;
  items: AcceptanceSummaryItem[];
};

export function useInvalidateLawmindQueries() {
  const queryClient = useQueryClient();
  return {
    invalidateHealth: (apiBase: string) =>
      queryClient.invalidateQueries({ queryKey: lawmindQueryKeys.health(apiBase) }),
    invalidateMatters: (apiBase: string) =>
      queryClient.invalidateQueries({ queryKey: ["lawmind", "matter", apiBase] }),
    invalidateReview: (apiBase: string) =>
      queryClient.invalidateQueries({ queryKey: ["lawmind", "review", apiBase] }),
    invalidateAll: (apiBase: string) => {
      void queryClient.invalidateQueries({ queryKey: ["lawmind", apiBase] });
    },
  };
}

export function useHealthQuery(apiBase: string | null, enabled = true) {
  return useQuery({
    queryKey: lawmindQueryKeys.health(apiBase ?? ""),
    enabled: Boolean(apiBase) && enabled,
    queryFn: () => apiGetJson<HealthPayload>(apiBase!, "/api/health"),
  });
}

export function useActionSummaryQuery(
  apiBase: string | null,
  matterId?: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: lawmindQueryKeys.actionSummary(apiBase ?? "", matterId),
    enabled: Boolean(apiBase) && enabled,
    queryFn: async () => {
      if (!apiBase) {
        return null;
      }
      return loadActionSummary(apiBase, matterId ?? undefined);
    },
    // Solo desktop: stay fresh while visible; pause when tab/window hidden.
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false;
      }
      return query.state.status === "error" ? false : 5_000;
    },
  });
}

export function useMatterOverviewsQuery(apiBase: string, enabled = true) {
  return useQuery({
    queryKey: lawmindQueryKeys.matterOverviews(apiBase),
    enabled: Boolean(apiBase) && enabled,
    queryFn: async (): Promise<MatterOverview[]> => {
      const j = await apiGetJson<{ ok?: boolean; overviews?: MatterOverview[] }>(
        apiBase,
        "/api/matters/overviews",
      );
      if (!j.ok || !Array.isArray(j.overviews)) {
        throw new Error(messageFromOkFalseBody(j, "加载案件列表失败"));
      }
      return j.overviews;
    },
  });
}

export function useMatterWorkspaceAcceptanceQuery(apiBase: string, enabled: boolean) {
  return useQuery({
    queryKey: lawmindQueryKeys.matterAcceptance(apiBase, "workspace"),
    enabled: Boolean(apiBase) && enabled,
    queryFn: async (): Promise<MatterWorkspaceAcceptance> => {
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
      return {
        count: j.count ?? j.items.length,
        readyCount: j.readyCount ?? 0,
        blockedCount: j.blockedCount ?? 0,
        items: j.items,
      };
    },
  });
}

export function useMatterSessionTimelineQuery(
  apiBase: string,
  matterId: string | null,
  panelTab: string,
) {
  return useQuery({
    queryKey: lawmindQueryKeys.matterSessionTimeline(apiBase, matterId ?? ""),
    enabled: Boolean(apiBase && matterId && panelTab === "timeline"),
    queryFn: async (): Promise<SessionTimelineEntry[]> => {
      const r = await apiGetJson<{ ok?: boolean; entries?: SessionTimelineEntry[] }>(
        apiBase,
        `/api/matters/session-timeline?matterId=${encodeURIComponent(matterId!)}&limit=30`,
      );
      return r.entries ?? [];
    },
  });
}

export type ReviewDraftDetailPayload = {
  draft: ArtifactDraft;
  citationIntegrity: DraftCitationIntegrityView | null;
  memorySources: MemorySourceLayer[] | null;
  acceptance: AcceptanceReport | null;
  reasoningReport: ReasoningReport | null;
  reasoningMarkdown: string | null;
  executionState: TaskExecutionState | null;
  gateDecisions: GateDecision[];
};

export function useReviewDraftListQuery(apiBase: string, enabled = true) {
  return useQuery({
    queryKey: lawmindQueryKeys.reviewDraftList(apiBase, null, "all"),
    enabled: Boolean(apiBase) && enabled,
    queryFn: async (): Promise<ArtifactDraft[]> => {
      const j = await apiGetJson<{ ok?: boolean; drafts?: ArtifactDraft[] }>(apiBase, "/api/drafts");
      if (!j.ok || !Array.isArray(j.drafts)) {
        throw new Error(messageFromOkFalseBody(j, "加载草稿列表失败"));
      }
      return j.drafts;
    },
  });
}

export function useReviewDraftDetailQuery(apiBase: string, taskId: string | null) {
  return useQuery({
    queryKey: lawmindQueryKeys.reviewDraftDetail(apiBase, taskId ?? ""),
    enabled: Boolean(apiBase && taskId),
    queryFn: async (): Promise<ReviewDraftDetailPayload> => {
      const j = await apiGetJson<{
        ok?: boolean;
        draft?: ArtifactDraft;
        citationIntegrity?: DraftCitationIntegrityView;
        memorySources?: MemorySourceLayer[];
        acceptance?: AcceptanceReport;
        reasoningReport?: ReasoningReport;
        reasoningMarkdown?: string | null;
        executionState?: TaskExecutionState;
        gateDecisions?: GateDecision[];
      }>(apiBase, `/api/drafts/${encodeURIComponent(taskId!)}`);
      if (!j.ok || !j.draft) {
        throw new Error(messageFromOkFalseBody(j, "加载草稿失败"));
      }
      return {
        draft: j.draft,
        citationIntegrity: j.citationIntegrity ?? null,
        memorySources: Array.isArray(j.memorySources) ? j.memorySources : null,
        acceptance: j.acceptance ?? null,
        reasoningReport: j.reasoningReport ?? null,
        reasoningMarkdown:
          typeof j.reasoningMarkdown === "string" && j.reasoningMarkdown.trim()
            ? j.reasoningMarkdown
            : null,
        executionState: j.executionState ?? null,
        gateDecisions: Array.isArray(j.gateDecisions) ? j.gateDecisions : [],
      };
    },
  });
}

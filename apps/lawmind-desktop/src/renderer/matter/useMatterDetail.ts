import { useCallback, useEffect, useState } from "react";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { ArtifactDraft, MatterOverview, MatterSummary, TaskRecord } from "../../../../../src/lawmind/types.ts";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import { apiGetJson, errorMessage, messageFromOkFalseBody } from "../api-client";
import { RECORDS_DESK_UNLINKED } from "../lawmind-records-desk-state";
import type { AcceptanceSummaryItem } from "./matter-acceptance-display";
import type { AuditEventRow, MatterSearchHit, OperationsFocus, OperationsSort } from "./matter-interaction";

export type UseMatterDetailInput = {
  apiBase: string;
  refreshVersion: number;
  matterListPlacement: "workbench" | "app-sidebar";
  selectedMatterKey: string | null;
  focusMatterId?: string | null;
  onFocusMatterIdApplied?: () => void;
};

export function useMatterDetail(input: UseMatterDetailInput) {
  const {
    apiBase,
    refreshVersion,
    matterListPlacement,
    selectedMatterKey,
    focusMatterId,
    onFocusMatterIdApplied,
  } = input;

  const [overviews, setOverviews] = useState<MatterOverview[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MatterSummary | null>(null);
  const [, setOverview] = useState<MatterOverview | null>(null);
  const [caseMemory, setCaseMemory] = useState("");
  const [caseTruncated, setCaseTruncated] = useState(false);
  const [coreIssues, setCoreIssues] = useState<string[]>([]);
  const [riskNotes, setRiskNotes] = useState<string[]>([]);
  const [progressEntries, setProgressEntries] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [drafts, setDrafts] = useState<ArtifactDraft[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [queueItems, setQueueItems] = useState<WorkQueueItem[]>([]);
  const [draftCitationByTask, setDraftCitationByTask] = useState<
    Record<string, DraftCitationIntegrityView>
  >({});
  const [acceptanceByTask, setAcceptanceByTask] = useState<Record<string, AcceptanceSummaryItem>>({});
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [opsFocus, setOpsFocus] = useState<OperationsFocus>("all");
  const [opsSort, setOpsSort] = useState<OperationsSort>("priority");
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<MatterSearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  const isAppSidebar = matterListPlacement === "app-sidebar";
  const navKey = isAppSidebar ? selectedMatterKey : internalSelectedId;
  const matterId = navKey && navKey !== RECORDS_DESK_UNLINKED ? navKey : null;

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const j = await apiGetJson<{ ok?: boolean; overviews?: MatterOverview[] }>(
        apiBase,
        `/api/matters/overviews?_=${encodeURIComponent(String(refreshVersion))}`,
      );
      if (j.ok && Array.isArray(j.overviews)) {
        setOverviews(j.overviews);
        return;
      }
      throw new Error(messageFromOkFalseBody(j, "加载案件列表失败"));
    } catch (e) {
      setListError(errorMessage(e, "加载案件列表失败"));
    } finally {
      setLoadingList(false);
    }
  }, [apiBase, refreshVersion]);

  const loadDetail = useCallback(
    async (targetMatterId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setSearchHits([]);
      setSearchQ("");
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          error?: string;
          summary?: MatterSummary;
          overview?: MatterOverview;
          caseMemory?: string;
          caseMemoryTruncated?: boolean;
          coreIssues?: string[];
          riskNotes?: string[];
          progressEntries?: string[];
          artifacts?: string[];
          tasks?: TaskRecord[];
          drafts?: ArtifactDraft[];
          approvalRequests?: ApprovalRequest[];
          queueItems?: WorkQueueItem[];
          draftCitationIntegrity?: Record<string, DraftCitationIntegrityView>;
          auditEvents?: AuditEventRow[];
        }>(apiBase, `/api/matters/detail?matterId=${encodeURIComponent(targetMatterId)}`);
        if (!j.ok) {
          throw new Error(messageFromOkFalseBody(j, "加载案件详情失败"));
        }
        setSummary(j.summary ?? null);
        setOverview(j.overview ?? null);
        setCaseMemory(j.caseMemory ?? "");
        setCaseTruncated(Boolean(j.caseMemoryTruncated));
        setCoreIssues(j.coreIssues ?? []);
        setRiskNotes(j.riskNotes ?? []);
        setProgressEntries(j.progressEntries ?? []);
        setArtifacts(j.artifacts ?? []);
        setTasks(j.tasks ?? []);
        setDrafts(j.drafts ?? []);
        setApprovalRequests(j.approvalRequests ?? []);
        setQueueItems(j.queueItems ?? []);
        setDraftCitationByTask(
          j.draftCitationIntegrity && typeof j.draftCitationIntegrity === "object"
            ? j.draftCitationIntegrity
            : {},
        );
        setAuditEvents(j.auditEvents ?? []);

        try {
          const accept = await apiGetJson<{
            ok?: boolean;
            items?: AcceptanceSummaryItem[];
          }>(apiBase, `/api/acceptance-summary?matterId=${encodeURIComponent(targetMatterId)}`);
          if (accept.ok && Array.isArray(accept.items)) {
            const next: Record<string, AcceptanceSummaryItem> = {};
            for (const item of accept.items) {
              next[item.taskId] = item;
            }
            setAcceptanceByTask(next);
          } else {
            setAcceptanceByTask({});
          }
        } catch {
          setAcceptanceByTask({});
        }
      } catch (e) {
        setDetailError(errorMessage(e, "加载案件详情失败"));
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (isAppSidebar) {
      setLoadingList(false);
      return;
    }
    void loadList();
  }, [loadList, isAppSidebar]);

  useEffect(() => {
    const id = focusMatterId?.trim();
    if (!id || isAppSidebar) {
      return;
    }
    setInternalSelectedId(id);
    onFocusMatterIdApplied?.();
  }, [focusMatterId, isAppSidebar, onFocusMatterIdApplied]);

  useEffect(() => {
    if (matterId) {
      void loadDetail(matterId);
    }
  }, [matterId, loadDetail]);

  return {
    overviews,
    setOverviews,
    loadingList,
    listError,
    internalSelectedId,
    setInternalSelectedId,
    detailLoading,
    detailError,
    summary,
    caseMemory,
    caseTruncated,
    coreIssues,
    riskNotes,
    progressEntries,
    artifacts,
    tasks,
    drafts,
    approvalRequests,
    queueItems,
    draftCitationByTask,
    acceptanceByTask,
    auditEvents,
    setAuditEvents,
    opsFocus,
    setOpsFocus,
    opsSort,
    setOpsSort,
    searchQ,
    setSearchQ,
    searchHits,
    setSearchHits,
    searchBusy,
    setSearchBusy,
    isAppSidebar,
    navKey,
    matterId,
    loadList,
    loadDetail,
  };
}

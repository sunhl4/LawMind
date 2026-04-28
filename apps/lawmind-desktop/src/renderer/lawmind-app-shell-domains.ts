import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArtifactDraft, TaskExecutionPlanStep, TaskRecord } from "../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { TaskCheckpoint } from "../../../../src/lawmind/tasks/checkpoints.ts";
import { loadAppDetail } from "./lawmind-app-detail";
import { errorMessage } from "./api-client";
import { loadAppBootstrapSnapshot, type AppConfig } from "./lawmind-app-bootstrap";
import {
  loadAssistantsPayload,
  loadCollaborationPayload,
  loadRecordsPayload,
  type CollabEvent,
  type DelegationRow,
  type HistoryItem,
  type PresetRow,
  type TaskRow,
} from "./lawmind-app-data";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import type { AssistantRow } from "./lawmind-settings-models.ts";
import type { TimeRangeFilter } from "./lawmind-sidebar";

function rangeStartMs(range: TimeRangeFilter): number | null {
  if (range === "all") {
    return null;
  }
  const now = Date.now();
  if (range === "today") {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  if (range === "7d") {
    return now - 7 * 86400000;
  }
  return now - 30 * 86400000;
}

export function selectStableAssistantId(
  assistants: AssistantRow[],
  previousAssistantId: string,
): string {
  if (previousAssistantId && assistants.some((assistant) => assistant.assistantId === previousAssistantId)) {
    return previousAssistantId;
  }
  return assistants[0]?.assistantId ?? DEFAULT_ASSISTANT_ID;
}

export function filterTasksForSidebar(
  tasks: TaskRow[],
  query: string,
  range: TimeRangeFilter,
  assistantId: string,
): TaskRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  const start = rangeStartMs(range);
  return tasks.filter((task) => {
    if (task.assistantId && task.assistantId !== assistantId) {
      return false;
    }
    if (start !== null) {
      const updatedAt = Date.parse(task.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt < start) {
        return false;
      }
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [task.taskId, task.title ?? "", task.summary, task.kind ?? ""]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function filterHistoryForSidebar(
  history: HistoryItem[],
  query: string,
  range: TimeRangeFilter,
  assistantId: string,
): HistoryItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const start = rangeStartMs(range);
  return history.filter((item) => {
    if (item.assistantId && item.assistantId !== assistantId) {
      return false;
    }
    if (start !== null) {
      const updatedAt = Date.parse(item.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt < start) {
        return false;
      }
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [item.id, item.label, item.kind, item.taskRecordKind ?? ""]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function useLawmindRecordsDomain(
  config: AppConfig | null,
  selectedAssistantId: string,
  setSelectedAssistantId: (assistantId: string | ((previous: string) => string)) => void,
  taskListQuery: string,
  listTimeRange: TimeRangeFilter,
) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [assistants, setAssistants] = useState<AssistantRow[]>([]);
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [delegations, setDelegations] = useState<DelegationRow[]>([]);
  const [collabEvents, setCollabEvents] = useState<CollabEvent[]>([]);

  const refreshLists = useCallback(async () => {
    if (!config) {
      return;
    }
    try {
      const payload = await loadRecordsPayload(config.apiBase);
      setTasks(payload.tasks);
      setHistory(payload.items);
    } catch {
      // Ignore refresh failures for passive sidebar updates.
    }
  }, [config]);

  const refreshCollaboration = useCallback(async () => {
    if (!config) {
      return;
    }
    try {
      const payload = await loadCollaborationPayload(config.apiBase);
      setDelegations(payload.delegations);
      setCollabEvents(payload.events.slice(-50));
    } catch {
      // Ignore refresh failures for passive collaboration updates.
    }
  }, [config]);

  const refreshAssistants = useCallback(async () => {
    if (!config) {
      return;
    }
    try {
      const payload = await loadAssistantsPayload(config.apiBase);
      setAssistants(payload.assistants);
      setPresets(payload.presets);
    } catch {
      // Ignore refresh failures for passive assistant updates.
    }
  }, [config]);

  const applyBootstrapSnapshot = useCallback(
    (snapshot: Awaited<ReturnType<typeof loadAppBootstrapSnapshot>>) => {
      setTasks(snapshot.records.tasks);
      setHistory(snapshot.records.items);
      setAssistants(snapshot.assistants.assistants);
      setPresets(snapshot.assistants.presets);
      setDelegations(snapshot.collaboration.delegations);
      setCollabEvents(snapshot.collaboration.events.slice(-50));
    },
    [],
  );

  useEffect(() => {
    if (assistants.length === 0) {
      return;
    }
    setSelectedAssistantId((previous) => selectStableAssistantId(assistants, previous));
  }, [assistants, setSelectedAssistantId]);

  const filteredTasks = useMemo(
    () => filterTasksForSidebar(tasks, taskListQuery, listTimeRange, selectedAssistantId),
    [tasks, taskListQuery, listTimeRange, selectedAssistantId],
  );
  const filteredHistory = useMemo(
    () => filterHistoryForSidebar(history, taskListQuery, listTimeRange, selectedAssistantId),
    [history, taskListQuery, listTimeRange, selectedAssistantId],
  );
  const selectedAssistant = assistants.find((assistant) => assistant.assistantId === selectedAssistantId);

  return {
    state: {
      tasks,
      history,
      assistants,
      presets,
      delegations,
      collabEvents,
    },
    derived: {
      filteredTasks,
      filteredHistory,
      selectedAssistant,
      selectedAssistantStats: selectedAssistant?.stats,
    },
    actions: {
      refreshLists,
      refreshCollaboration,
      refreshAssistants,
      applyBootstrapSnapshot,
    },
  };
}

export function useLawmindDetailDomain(config: AppConfig | null) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailKind, setDetailKind] = useState<"task" | "draft" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [detailDraft, setDetailDraft] = useState<ArtifactDraft | null>(null);
  const [detailCitationIntegrity, setDetailCitationIntegrity] = useState<DraftCitationIntegrityView | null>(null);
  const [detailCheckpoints, setDetailCheckpoints] = useState<TaskCheckpoint[] | null>(null);
  const [detailExecutionPlan, setDetailExecutionPlan] = useState<TaskExecutionPlanStep[] | null>(null);

  const openDetail = useCallback(
    async (kind: "task" | "draft", id: string) => {
      if (!config) {
        return;
      }
      setDetailOpen(true);
      setDetailKind(kind);
      setDetailId(id);
      setDetailLoading(true);
      setDetailError(null);
      setDetailTask(null);
      setDetailDraft(null);
      setDetailCitationIntegrity(null);
      setDetailCheckpoints(null);
      setDetailExecutionPlan(null);
      try {
        const detail = await loadAppDetail(config.apiBase, kind, id);
        if (kind === "task" && detail.task) {
          setDetailTask(detail.task);
          setDetailCheckpoints(Array.isArray(detail.checkpoints) ? detail.checkpoints : null);
          setDetailExecutionPlan(Array.isArray(detail.executionPlan) ? detail.executionPlan : null);
        } else if (kind === "draft" && detail.draft) {
          setDetailDraft(detail.draft);
          setDetailCitationIntegrity(detail.citationIntegrity ?? null);
        } else {
          throw new Error("empty response");
        }
      } catch (cause) {
        setDetailError(errorMessage(cause, "加载详情失败"));
      } finally {
        setDetailLoading(false);
      }
    },
    [config],
  );

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailKind(null);
    setDetailId(null);
    setDetailTask(null);
    setDetailDraft(null);
    setDetailCitationIntegrity(null);
    setDetailCheckpoints(null);
    setDetailExecutionPlan(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  return {
    state: {
      detailOpen,
      detailKind,
      detailId,
      detailLoading,
      detailError,
      detailTask,
      detailDraft,
      detailCitationIntegrity,
      detailCheckpoints,
      detailExecutionPlan,
    },
    actions: {
      openDetail,
      closeDetail,
    },
  };
}

import type { AssistantRow } from "./lawmind-settings-models.ts";
import { apiGetJson } from "./api-client";

export type HealthPayload = {
  ok?: boolean;
  modelConfigured?: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
};

export type TaskRow = {
  taskId: string;
  summary: string;
  title?: string;
  kind?: string;
  status: string;
  output?: string;
  outputPath?: string;
  updatedAt: string;
  createdAt?: string;
  matterId?: string;
  assistantId?: string;
  sessionId?: string;
};

export type HistoryItem = {
  kind: "task" | "draft";
  id: string;
  label: string;
  updatedAt: string;
  createdAt?: string;
  status?: string;
  outputPath?: string;
  matterId?: string;
  taskRecordKind?: string;
  assistantId?: string;
};

export type DelegationRow = {
  delegationId: string;
  fromAssistant: string;
  toAssistant: string;
  task: string;
  status: string;
  priority: string;
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
};

export type CollabEvent = {
  eventId: string;
  kind: string;
  fromAssistantId: string;
  toAssistantId: string;
  matterId?: string;
  detail?: string;
  timestamp: string;
};

export type PresetRow = {
  id: string;
  displayName: string;
  promptSection: string;
};

export type CollaborationSummaryPayload = {
  ok?: boolean;
  collaborationEnabled?: boolean;
  collaborationHint?: string;
  delegationCount?: number;
};

export async function loadHealthPayload(apiBase: string): Promise<HealthPayload> {
  return apiGetJson<HealthPayload>(apiBase, "/api/health");
}

export async function loadRecordsPayload(apiBase: string): Promise<{
  tasks: TaskRow[];
  items: HistoryItem[];
}> {
  const [tr, hi] = await Promise.all([
    apiGetJson<{ ok?: boolean; tasks?: TaskRow[] }>(apiBase, "/api/tasks"),
    apiGetJson<{ ok?: boolean; items?: HistoryItem[] }>(apiBase, "/api/history"),
  ]);
  return {
    tasks: tr.ok && Array.isArray(tr.tasks) ? tr.tasks : [],
    items: hi.ok && Array.isArray(hi.items) ? hi.items : [],
  };
}

export async function loadAssistantsPayload(apiBase: string): Promise<{
  assistants: AssistantRow[];
  presets: PresetRow[];
}> {
  const j = await apiGetJson<{
    ok?: boolean;
    assistants?: AssistantRow[];
    presets?: PresetRow[];
  }>(apiBase, "/api/assistants");
  return {
    assistants: j.ok && Array.isArray(j.assistants) ? j.assistants : [],
    presets: Array.isArray(j.presets) ? j.presets : [],
  };
}

export async function loadCollaborationPayload(apiBase: string): Promise<{
  delegations: DelegationRow[];
  events: CollabEvent[];
}> {
  const [dr, er] = await Promise.all([
    apiGetJson<{ ok?: boolean; delegations?: DelegationRow[] }>(apiBase, "/api/delegations"),
    apiGetJson<{ ok?: boolean; events?: CollabEvent[] }>(apiBase, "/api/collaboration-events"),
  ]);
  return {
    delegations: dr.ok && Array.isArray(dr.delegations) ? dr.delegations : [],
    events: er.ok && Array.isArray(er.events) ? er.events : [],
  };
}

export async function loadCollaborationSummaryPayload(
  apiBase: string,
): Promise<CollaborationSummaryPayload> {
  return apiGetJson<CollaborationSummaryPayload>(apiBase, "/api/collaboration/summary");
}

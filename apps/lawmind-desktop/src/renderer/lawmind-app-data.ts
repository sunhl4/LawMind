import type { AssistantRow } from "./lawmind-settings-models.ts";
import type { MatterOverview } from "../../../../src/lawmind/types.ts";
import { apiGetJson } from "./api-client";

export type WorkspaceStandardCheck = {
  id: string;
  label: string;
  state: "ok" | "warn" | "missing";
  hint: string;
};

export type HealthPayload = {
  ok?: boolean;
  /** 主对话模型 API 是否已配置（来自 GET /api/health） */
  modelConfigured?: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
  modelName?: string | null;
  modelEnvFileExists?: boolean;
  edition?: {
    id?: string;
    label?: string;
    features?: {
      strictDangerousToolApproval?: boolean;
      auditIntegrityExport?: boolean;
    };
  };
  policy?: {
    networkAllowlist?: string[] | null;
    networkAllowlistEnforced?: boolean | null;
    loaded?: boolean;
    allowWebSearch?: boolean | null;
  };
  usageSummary?: {
    entries?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    since?: string;
    until?: string;
  };
  doctor?: {
    taskCount?: number;
    draftCount?: number;
    auditJsonlFileCount?: number;
    researchSnapshotCount?: number;
    nodeVersion?: string;
    lawmindPackageVersion?: string | null;
    memoryTruthSources?: {
      memoryMd?: boolean;
      lawyerProfile?: boolean;
      firmProfile?: boolean;
      clientProfileRoot?: boolean;
      clientProfileFilesUnderClients?: number;
    };
    workspaceStandard?: {
      ok?: boolean;
      checks?: WorkspaceStandardCheck[];
    };
    sessionHealth?: {
      score?: number;
      grade?: "good" | "attention" | "risk";
      summary?: string;
      signals?: Array<{ id: string; label: string; severity: string }>;
    };
    usageSummary?: HealthPayload["usageSummary"];
    integrations?: {
      connectors?: Array<{
        id: string;
        label: string;
        phase: "M1" | "M2" | "M3";
        status: "active" | "disabled" | "unconfigured";
        hint?: string;
      }>;
    };
    searchIndex?: {
      ready?: boolean;
      rowCount?: number;
      auditRows?: number;
      sessionRows?: number;
      lastRebuildAt?: string;
      truncated?: boolean;
    };
    p2?: {
      toolSandbox?: {
        enabled?: boolean;
        source?: "env" | "policy" | "off";
        sandboxedToolNames?: string[];
      };
      teamMemorySync?: {
        allowed?: boolean;
        reason?: string;
      };
    };
  };
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
  /** 子助手承接委派的会话（可打开继续指导） */
  targetSessionId?: string;
  /** 发起委派时律师侧主会话 */
  parentSessionId?: string;
  matterId?: string;
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

export type GateHistoryItem = {
  eventId: string;
  taskId: string;
  timestamp: string;
  actor: string;
  actorId?: string;
  source: string;
  executionState?: {
    phase: string;
    status: string;
    detail?: string;
  };
  gateDecisions: Array<{
    gate: string;
    decision: string;
    reason?: string;
  }>;
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
  gateHistory: GateHistoryItem[];
}> {
  const [dr, er, gh] = await Promise.all([
    apiGetJson<{ ok?: boolean; delegations?: DelegationRow[] }>(apiBase, "/api/delegations"),
    apiGetJson<{ ok?: boolean; events?: CollabEvent[] }>(apiBase, "/api/collaboration-events"),
    apiGetJson<{ ok?: boolean; items?: GateHistoryItem[] }>(apiBase, "/api/platform/gate-history?limit=60"),
  ]);
  return {
    delegations: dr.ok && Array.isArray(dr.delegations) ? dr.delegations : [],
    events: er.ok && Array.isArray(er.events) ? er.events : [],
    gateHistory: gh.ok && Array.isArray(gh.items) ? gh.items : [],
  };
}

export async function loadCollaborationSummaryPayload(
  apiBase: string,
): Promise<CollaborationSummaryPayload> {
  return apiGetJson<CollaborationSummaryPayload>(apiBase, "/api/collaboration/summary");
}

export async function loadMatterOverviewsPayload(apiBase: string, cacheBustKey?: number): Promise<MatterOverview[]> {
  const qs =
    cacheBustKey !== undefined && Number.isFinite(cacheBustKey)
      ? `?_=${encodeURIComponent(String(cacheBustKey))}`
      : "";
  const j = await apiGetJson<{ ok?: boolean; overviews?: MatterOverview[] }>(
    apiBase,
    `/api/matters/overviews${qs}`,
  );
  return j.ok && Array.isArray(j.overviews) ? j.overviews : [];
}

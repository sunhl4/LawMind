import type { AssistantRow } from "./lawmind-settings-models.ts";
import type { MatterOverview } from "../../../../src/lawmind/types.ts";
import { apiGetJson } from "./api-client";

export type WorkspaceStandardCheck = {
  id: string;
  label: string;
  state: "ok" | "warn" | "missing";
  hint: string;
};

/**
 * `GET /api/daemon` 与 `GET /api/health` 里 `lawmindDaemon` 的同一个契约。
 *
 * `recap` 由服务端组装（渲染进程不能 import 引擎里依赖 `node:fs` 的模块），
 * `null` 表示一切正常——静默成功不打扰。
 */
export type LawmindDaemonPayload = {
  enabled?: boolean;
  running?: boolean;
  pid?: number;
  lastTickAt?: string;
  /** 心跳时间与过期判定：区分「进程没了」与「循环卡死」。 */
  heartbeatAt?: string;
  heartbeatAgeMs?: number;
  heartbeatStale?: boolean;
  /** 自动重启次数；0 表示从未中断。 */
  restartCount?: number;
  lastExitClass?: "clean" | "crashed" | "killed" | "stopped";
  supervisionGaveUp?: boolean;
  /** 拉起的后台进程尚未落 pid（刚点「开启」的瞬间）。 */
  starting?: boolean;
  recap?: { headline: string; details: string[] } | null;
};

export type HealthPayload = {
  ok?: boolean;
  /** 主对话模型 API 是否已配置（来自 GET /api/health） */
  modelConfigured?: boolean;
  /** 当前主模型是否已通过 POST /api/models/test */
  modelVerified?: boolean;
  /** 是否允许「用模型起草」偏好（设置→模型检索） */
  draftWithModelEnabled?: boolean;
  /** 当前运行态是否已激活「用模型起草」（需已配置模型） */
  draftWithModelActive?: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
  webSearchNativeAvailable?: boolean;
  webSearchReady?: boolean;
  modelName?: string | null;
  modelEnvFileExists?: boolean;
  lawmindDaemon?: LawmindDaemonPayload;
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
    /** 出站总模式：`"offline"` 时联网被强制关闭，与 allowWebSearch 偏好无关。 */
    egressMode?: "open" | "allowlisted" | "offline" | null;
    applied?: string[];
    effective?: Array<{ key: string; reason: string }>;
    rejected?: Array<{ key: string; reason: string }>;
    migrated?: Array<{ key: string; reason: string }>;
  };
  usageSummary?: {
    entries?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    since?: string;
    until?: string;
    byModel?: Array<{ model: string; entries: number; totalTokens: number }>;
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
      knowledgeRows?: number;
      lastRebuildAt?: string;
      truncated?: boolean;
      stale?: boolean;
      staleReason?: "index_missing" | "last_rebuild_unknown" | "sources_changed";
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
    matterConsistency?: {
      ok?: boolean;
      issueCount?: number;
      issues?: Array<{ matterId: string; code: string; message: string }>;
    };
    taskDraftConsistency?: {
      ok?: boolean;
      issueCount?: number;
      issues?: Array<{ taskId: string; code: string; message: string }>;
    };
    /** 权威库端点契约（同步；未配置 / 无效 / 已配置 / 演示语料就绪 / 适配器未实现） */
    authorityCorpus?: {
      configured?: boolean;
      status?: "unset" | "invalid" | "configured" | "sample-ready" | "unimplemented";
      endpointHost?: string | null;
      authConfigured?: boolean;
      provider?: "open" | "generic" | "pkulaw" | "lexis";
      providerLabel?: string;
      message?: string;
      envKey?: string;
      authEnvKey?: string;
      providerEnvKey?: string;
    };
    companyRegistry?: {
      configured?: boolean;
      envKey?: string;
      message?: string;
    };
    /** 离线许可（软门槛）：到期/未激活只提醒，不阻断交办。 */
    license?: {
      status?: "licensed" | "licensed_expired" | "trial" | "trial_expired" | "invalid" | "missing";
      edition?: string;
      licensee?: string;
      expiresAt?: string;
      trialDaysLeft?: number;
      message?: string;
      blocking?: boolean;
    };
    /** 律师交办成绩单（Doctor 可见；样本不足时值为「暂无样本」）。 */
    scorecardRows?: Array<{
      id: string;
      label: string;
      value: string;
      rate: number | null;
      detail?: string;
    }>;
    authorityUsage?: {
      day?: string;
      ok?: number;
      error?: number;
      total?: number;
      message?: string;
    };
    multitaskObservability?: {
      windowDays?: number;
      jobsTotal?: number;
      jobsInWindow?: number;
      leadTimeP50Ms?: number | null;
      leadTimeP90Ms?: number | null;
      retryRate?: number;
      cancelRate?: number;
      failureRate?: number;
      conflictRate?: number;
      notes?: string[];
    };
    reasoningGraphCoverage?: {
      requiredDraftCount?: number;
      withSnapshotCount?: number;
      ratio?: number | null;
    };
    corruptSessionCount?: number;
    danglingToolCallCount?: number;
    orphanToolResultCount?: number;
    process?: {
      degraded?: boolean;
      uncaughtExceptions?: number;
      unhandledRejections?: number;
    };
    /** Skills E4 / E10-lite */
    citationMode?: "grounded" | "assisted" | "off";
    citationModeActive?: boolean;
    triageRulesLoaded?: boolean;
    triageRuleCount?: number;
    productMetricsSummary?: {
      total?: number;
      triageConfirmed?: number;
      gateFailures?: number;
      firstPassOk?: number;
      rewrites?: number;
      rewriteAmplitudeSamples?: number;
    };
    privateDeployChecklist?: {
      applicable?: boolean;
      passCount?: number;
      total?: number;
      items?: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
    };
    fleetPlaybooksLoaded?: boolean;
    fleetPlaybookCount?: number;
    judgmentHardControls?: {
      intakeSoftAsk?: boolean;
      updateDraftAmplitudeSoft?: boolean;
      emptyRedlineHard?: boolean;
      sendEmailApprovalHard?: boolean;
    };
  };
  citationMode?: "grounded" | "assisted" | "off";
  citationModeActive?: boolean;
  triageRulesLoaded?: boolean;
  triageRuleCount?: number;
  fleetPlaybooksLoaded?: boolean;
  fleetPlaybookCount?: number;
  agentMandatoryRulesActive?: boolean;
  agentMandatoryRulesTruncated?: boolean;
  promptSections?: Array<{
    id: string;
    title: string;
    always: boolean;
    cache?: "static" | "session" | "turn";
  }>;
  capabilityEnvelope?: {
    conversationLength?: "200k" | "500k" | "1m" | null;
    contextTokens?: number | null;
    maxOutputTokens?: number | null;
    temperature?: number | null;
    toolCallsPerTurn?: number | null;
    maxHistoryMessages?: number | null;
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
    category?: "safety_hard" | "judgment_soft";
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

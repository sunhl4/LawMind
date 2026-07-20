import type { AgentFleetSummary, AgentPreset, AgentRunSummary } from "../../../../src/lawmind/platform/agent-fleet.ts";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { apiGetJson } from "./api-client";

export type { AgentFleetSummary, AgentPreset, AgentRunSummary };

export type FleetTranscriptPayload = {
  ok: boolean;
  sessionId: string;
  title: string;
  matterId?: string;
  assistantId?: string;
  updatedAt: string;
  messages: Array<{ role: string; content: string }>;
  executionState?: import("../../../../src/lawmind/platform/contracts.ts").TaskExecutionState;
  pendingRequiresAction?: import("./lawmind-requires-action").LawMindRequiresAction[];
};

/** Skip desk sentinel keys / invalid IDs so fleet APIs do not 400. */
export function matterIdQueryParam(matterId?: string | null): string {
  const t = matterId?.trim() ?? "";
  if (!t || !isValidMatterId(t)) {
    return "";
  }
  return `?matterId=${encodeURIComponent(t)}`;
}

export async function loadAgentFleet(
  apiBase: string,
  matterId?: string | null,
): Promise<AgentFleetSummary> {
  const res = await apiGetJson<{ ok?: boolean } & AgentFleetSummary>(
    apiBase,
    `/api/agent-fleet${matterIdQueryParam(matterId)}`,
  );
  return {
    runs: res.runs ?? [],
    specialization: res.specialization ?? {},
    counts: res.counts ?? { total: 0, active: 0, awaitingAction: 0, byKind: {} as AgentFleetSummary["counts"]["byKind"] },
  };
}

export async function loadAgentPresets(apiBase: string): Promise<AgentPreset[]> {
  const res = await apiGetJson<{ ok?: boolean; presets?: AgentPreset[] }>(apiBase, "/api/agent-presets");
  return res.presets ?? [];
}

export async function loadFleetTranscript(
  apiBase: string,
  sessionId: string,
): Promise<FleetTranscriptPayload | null> {
  const res = await apiGetJson<FleetTranscriptPayload>(
    apiBase,
    `/api/sessions/${encodeURIComponent(sessionId)}/fleet-transcript`,
  );
  return res.ok ? res : null;
}

export function agentRunStatusLabel(status: AgentRunSummary["status"]): string {
  switch (status) {
    case "queued":
      return "排队";
    case "running":
      return "执行中";
    case "scheduled":
      return "已预约";
    case "awaiting_approval":
      return "待批准";
    case "awaiting_clarification":
      return "待澄清";
    case "awaiting_review":
      return "待签批";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

export function agentRunKindLabel(kind: AgentRunSummary["kind"]): string {
  switch (kind) {
    case "chat":
      return "对话";
    case "delegation":
      return "委派";
    case "workflow_job":
      return "工作流";
    case "queue_item":
      return "队列";
    case "tool_approval":
      return "工具批准";
    case "matter_approval":
      return "案件审批";
    case "pending_review":
      return "文书";
  }
}

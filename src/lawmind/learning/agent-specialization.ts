/**
 * Per-role / per-assistant specialization metrics (数字团队进化指标).
 * Persists under workspace/quality/agent-specialization.json
 */

import fs from "node:fs";
import path from "node:path";

export type AgentSpecializationStats = {
  assistantId: string;
  roleId?: string;
  tasksReviewed: number;
  firstPassApprovals: number;
  materialRewrites: number;
  lastUpdatedAt: string;
};

export type AgentSpecializationStore = {
  version: 1;
  byAssistant: Record<string, AgentSpecializationStats>;
};

function storePath(workspaceDir: string): string {
  return path.join(workspaceDir, "quality", "agent-specialization.json");
}

export function loadAgentSpecializationStore(workspaceDir: string): AgentSpecializationStore {
  const p = storePath(workspaceDir);
  try {
    if (!fs.existsSync(p)) {
      return { version: 1, byAssistant: {} };
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as AgentSpecializationStore;
    if (raw?.version !== 1 || typeof raw.byAssistant !== "object") {
      return { version: 1, byAssistant: {} };
    }
    return raw;
  } catch {
    return { version: 1, byAssistant: {} };
  }
}

export function recordAgentReviewOutcome(params: {
  workspaceDir: string;
  assistantId: string;
  roleId?: string;
  firstPass: boolean;
}): AgentSpecializationStats {
  const store = loadAgentSpecializationStore(params.workspaceDir);
  const prev = store.byAssistant[params.assistantId];
  const next: AgentSpecializationStats = {
    assistantId: params.assistantId,
    roleId: params.roleId ?? prev?.roleId,
    tasksReviewed: (prev?.tasksReviewed ?? 0) + 1,
    firstPassApprovals: (prev?.firstPassApprovals ?? 0) + (params.firstPass ? 1 : 0),
    materialRewrites: (prev?.materialRewrites ?? 0) + (params.firstPass ? 0 : 1),
    lastUpdatedAt: new Date().toISOString(),
  };
  store.byAssistant[params.assistantId] = next;
  const dir = path.dirname(storePath(params.workspaceDir));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(params.workspaceDir), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return next;
}

export function firstPassRate(stats: AgentSpecializationStats): number {
  if (stats.tasksReviewed <= 0) {
    return 0;
  }
  return stats.firstPassApprovals / stats.tasksReviewed;
}

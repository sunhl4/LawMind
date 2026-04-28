/**
 * Shared memory — cross-assistant case context and collaboration artifacts.
 *
 * When assistants collaborate, they need to share:
 *   1. Case context from the common workspace
 *   2. Results from previous collaboration steps
 *   3. Insights that one assistant discovered and another needs
 *
 * This module extends the existing memory layer (src/lawmind/memory/)
 * with collaboration-specific context loading and artifact storage.
 *
 * Collaboration artifacts are stored under:
 *   workspace/collaboration/<matterId>/<delegationId>.md
 */

import fs from "node:fs";
import path from "node:path";
import { loadMemoryContext, type MemoryContext } from "../../memory/index.js";
import { readCollaborationEvents } from "./audit.js";
import { listDelegations } from "./delegation-registry.js";
import type { CollaborationEvent } from "./types.js";

const COLLABORATION_DIR = "collaboration";

function collaborationDir(workspaceDir: string, matterId?: string): string {
  if (matterId) {
    return path.join(workspaceDir, COLLABORATION_DIR, matterId);
  }
  return path.join(workspaceDir, COLLABORATION_DIR);
}

// ─────────────────────────────────────────────
// Collaboration Context Loading
// ─────────────────────────────────────────────

export type CollaborationContext = {
  /** Full `loadMemoryContext` snapshot (case, firm, client profile, logs, …) */
  baseMemory: MemoryContext;
  /** Recent collaboration results relevant to this assistant/matter */
  recentCollaborations: Array<{
    fromAssistant: string;
    toAssistant: string;
    task: string;
    result: string;
    completedAt: string;
  }>;
  /** Recent collaboration events */
  recentEvents: CollaborationEvent[];
  /** Saved collaboration artifacts for this matter */
  artifacts: string[];
};

/**
 * Load collaboration-enriched memory context.
 *
 * Extends the base memory with collaboration results and events
 * relevant to the current assistant and matter.
 */
export async function loadCollaborationContext(params: {
  workspaceDir: string;
  assistantId?: string;
  matterId?: string;
  maxRecentResults?: number;
}): Promise<CollaborationContext> {
  const { workspaceDir, assistantId, matterId } = params;
  const maxRecent = params.maxRecentResults ?? 10;

  const baseMemory = await loadMemoryContext(workspaceDir, { matterId });

  const relevantDelegations = listDelegations({
    status: "completed",
    matterId,
  })
    .filter((d) => {
      if (!assistantId) {
        return true;
      }
      return d.fromAssistantId === assistantId || d.toAssistantId === assistantId;
    })
    .slice(0, maxRecent);

  const recentCollaborations = relevantDelegations
    .filter((d) => d.result)
    .map((d) => ({
      fromAssistant: d.fromAssistantId,
      toAssistant: d.toAssistantId,
      task: d.task.slice(0, 200),
      result: d.result!.slice(0, 2000),
      completedAt: d.completedAt ?? d.startedAt,
    }));

  const recentEvents = readCollaborationEvents(workspaceDir)
    .filter((e) => {
      if (matterId && e.matterId && e.matterId !== matterId) {
        return false;
      }
      if (!assistantId) {
        return true;
      }
      return e.fromAssistantId === assistantId || e.toAssistantId === assistantId;
    })
    .slice(-20);

  const artifacts = listCollaborationArtifacts(workspaceDir, matterId);

  return {
    baseMemory,
    recentCollaborations,
    recentEvents,
    artifacts,
  };
}

// ─────────────────────────────────────────────
// Collaboration Artifact Storage
// ─────────────────────────────────────────────

/**
 * Save a collaboration result as a persistent artifact.
 *
 * Artifacts are Markdown files stored under workspace/collaboration/<matterId>/
 * so they can be found by other assistants via search tools.
 */
export function saveCollaborationArtifact(params: {
  workspaceDir: string;
  matterId?: string;
  delegationId: string;
  fromAssistant: string;
  toAssistant: string;
  task: string;
  result: string;
}): string {
  const { workspaceDir, matterId, delegationId, fromAssistant, toAssistant, task, result } = params;
  const dir = collaborationDir(workspaceDir, matterId);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${delegationId}.md`;
  const filePath = path.join(dir, fileName);

  const content = `# 协作结果

- **委派方**: ${fromAssistant}
- **执行方**: ${toAssistant}
- **案件**: ${matterId ?? "（无）"}
- **时间**: ${new Date().toISOString()}

## 任务

${task}

## 结果

${result}
`;

  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * List all collaboration artifacts for a matter (or all matters).
 */
export function listCollaborationArtifacts(workspaceDir: string, matterId?: string): string[] {
  const dir = collaborationDir(workspaceDir, matterId);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    return files.map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Read a collaboration artifact by delegation ID.
 */
export function readCollaborationArtifact(
  workspaceDir: string,
  delegationId: string,
  matterId?: string,
): string | undefined {
  const dir = collaborationDir(workspaceDir, matterId);
  const filePath = path.join(dir, `${delegationId}.md`);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────
// Collaboration Summary for System Prompt
// ─────────────────────────────────────────────

/**
 * Build a short summary of recent collaboration activity suitable for
 * injection into the system prompt as additional context.
 */
export function buildCollaborationSummary(params: {
  workspaceDir: string;
  assistantId?: string;
  matterId?: string;
}): string {
  const { assistantId, matterId } = params;

  const recentDelegations = listDelegations({ status: "completed", matterId })
    .filter((d) => {
      if (!assistantId) {
        return true;
      }
      return d.fromAssistantId === assistantId || d.toAssistantId === assistantId;
    })
    .slice(0, 5);

  if (recentDelegations.length === 0) {
    return "";
  }

  const lines: string[] = ["## 近期协作记录"];
  for (const d of recentDelegations) {
    const direction = d.fromAssistantId === assistantId ? "委派给" : "收到来自";
    const peer = d.fromAssistantId === assistantId ? d.toAssistantId : d.fromAssistantId;
    lines.push(
      `- ${direction}「${peer}」: ${d.task.slice(0, 80)} → ${d.status}${d.result ? ` (有结果)` : ""}`,
    );
  }

  return lines.join("\n");
}

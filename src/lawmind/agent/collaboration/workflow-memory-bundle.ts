/**
 * Assistant / role memory snapshot for workflow job distribution (P2).
 * Captures per-assignee PROFILE excerpts at enqueue time so scheduled runs stay consistent.
 */

import { readAssistantProfileMarkdown } from "../../assistants/profile-md.js";
import type { CollaborationWorkflow } from "../orchestrator/types.js";

const PROFILE_EXCERPT_MAX = 2048;

export type WorkflowMemoryBundleSnapshot = {
  capturedAt: string;
  profiles: Array<{ assistantId: string; excerpt: string }>;
};

function excerptProfile(markdown: string): string {
  const t = markdown.trim();
  if (t.length <= PROFILE_EXCERPT_MAX) {
    return t;
  }
  return `${t.slice(0, PROFILE_EXCERPT_MAX)}\n…`;
}

/**
 * Collect assignee assistant PROFILE.md excerpts for workflow steps.
 */
export function collectWorkflowMemoryBundle(
  lawMindRoot: string,
  workflow: CollaborationWorkflow,
): WorkflowMemoryBundleSnapshot {
  const seen = new Set<string>();
  const profiles: WorkflowMemoryBundleSnapshot["profiles"] = [];
  for (const step of workflow.steps) {
    const id = step.assignee?.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    try {
      const md = readAssistantProfileMarkdown(lawMindRoot, id);
      if (md.trim()) {
        profiles.push({ assistantId: id, excerpt: excerptProfile(md) });
      }
    } catch {
      /* skip missing assistant */
    }
  }
  return { capturedAt: new Date().toISOString(), profiles };
}

export function profileExcerptForAssignee(
  bundle: WorkflowMemoryBundleSnapshot | undefined,
  assigneeId: string,
): string | undefined {
  if (!bundle) {
    return undefined;
  }
  const row = bundle.profiles.find((p) => p.assistantId === assigneeId);
  return row?.excerpt;
}

export function appendMemoryBundleToTask(
  task: string,
  bundle: WorkflowMemoryBundleSnapshot | undefined,
  assigneeId: string,
): string {
  const excerpt = profileExcerptForAssignee(bundle, assigneeId);
  if (!excerpt) {
    return task;
  }
  return `## 本步骤助手偏好（enqueue 快照）\n${excerpt}\n\n${task}`;
}

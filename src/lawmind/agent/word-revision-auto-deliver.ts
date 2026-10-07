/**
 * After a Word-revision turn, write sibling tracked Words for drafts that
 * already have revisions but no successful export this turn.
 * One pass. Never while paused, clarifying, or readonly.
 */

import { readRedlineProposal } from "../drafts/redline-proposal.js";
import { openWordCheckMarker } from "../drafts/word-review.js";
import { READONLY_AGENT_TOOL_NAMES, RESEARCH_AGENT_TOOL_NAMES } from "./permission-mode.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { AgentContext, AgentMessage, AgentTurn } from "./types.js";

const TASK_TOOLS = new Set([
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "render_tracked_draft",
]);

function taskIdOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const id = (data as { taskId?: unknown }).taskId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function outputPathOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const path = (data as { outputPath?: unknown }).outputPath;
  return typeof path === "string" && path.trim() ? path.trim() : undefined;
}

export function wordRevisionDeliveryAllowed(params: {
  ctx: AgentContext;
  turn: AgentTurn;
}): boolean {
  if (!params.ctx.wordRevisionTurn) {
    return false;
  }
  if (params.turn.status !== "completed") {
    return false;
  }
  if (params.ctx.clarificationBlockingHeavyTools === true) {
    return false;
  }
  const mode = params.ctx.permissionMode;
  return mode !== "readonly" && mode !== "research";
}

/** Task ids touched this turn, plus the linked draft. */
export function wordRevisionTaskIds(turn: AgentTurn, linkedTaskId?: string): Set<string> {
  const ids = new Set<string>();
  if (linkedTaskId?.trim()) {
    ids.add(linkedTaskId.trim());
  }
  for (const msg of turn.messages ?? []) {
    collectTaskIds(msg, ids);
  }
  return ids;
}

function collectTaskIds(msg: AgentMessage, ids: Set<string>): void {
  for (const resp of msg.toolCallResponses ?? []) {
    if (!TASK_TOOLS.has(resp.name)) {
      continue;
    }
    const id = taskIdOf(resp.result.data);
    if (id) {
      ids.add(id);
    }
  }
}

export function successfullyExportedTaskIds(turn: AgentTurn): Set<string> {
  const ids = new Set<string>();
  for (const msg of turn.messages ?? []) {
    for (const resp of msg.toolCallResponses ?? []) {
      if (resp.name !== "render_tracked_draft" || !resp.result.ok) {
        continue;
      }
      const id = taskIdOf(resp.result.data);
      if (id && outputPathOf(resp.result.data)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

export function draftHasLiveHunks(workspaceDir: string, taskId: string): boolean {
  const proposal = readRedlineProposal(workspaceDir, taskId);
  return (proposal?.hunks ?? []).some((hunk) => hunk.status !== "rejected");
}

/** Revised this turn, not yet written beside the source. */
export function draftsNeedingTrackedExport(ctx: AgentContext, turn: AgentTurn): string[] {
  const done = successfullyExportedTaskIds(turn);
  const out: string[] = [];
  for (const taskId of wordRevisionTaskIds(turn, ctx.linkedTaskId)) {
    if (done.has(taskId)) {
      continue;
    }
    if (!draftHasLiveHunks(ctx.workspaceDir, taskId)) {
      continue;
    }
    out.push(taskId);
  }
  return out;
}

export function shouldAutoDeliverWordRevision(params: {
  ctx: AgentContext;
  turn: AgentTurn;
}): boolean {
  if (!wordRevisionDeliveryAllowed(params)) {
    return false;
  }
  return draftsNeedingTrackedExport(params.ctx, params.turn).length > 0;
}

export async function autoDeliverWordRevisionIfNeeded(params: {
  ctx: AgentContext;
  registry: ToolRegistry;
  turn: AgentTurn;
}): Promise<string | undefined> {
  if (!wordRevisionDeliveryAllowed(params)) {
    return undefined;
  }
  const pending = draftsNeedingTrackedExport(params.ctx, params.turn);
  if (pending.length === 0) {
    return undefined;
  }
  const tool = params.registry.get("render_tracked_draft");
  if (!tool) {
    return undefined;
  }
  if (
    params.ctx.permissionMode === "readonly" &&
    !READONLY_AGENT_TOOL_NAMES.has("render_tracked_draft")
  ) {
    return undefined;
  }
  if (
    params.ctx.permissionMode === "research" &&
    !RESEARCH_AGENT_TOOL_NAMES.has("render_tracked_draft")
  ) {
    return undefined;
  }
  const lines: string[] = [];
  for (const taskId of pending) {
    const result = await tool.execute({ task_id: taskId }, params.ctx);
    if (!result.ok) {
      continue;
    }
    const data = result.data as { message?: string; outputPath?: string } | undefined;
    if (typeof data?.message === "string" && data.message.trim()) {
      lines.push(data.message.trim());
    } else if (typeof data?.outputPath === "string" && data.outputPath.trim()) {
      lines.push(`已写出源文件同目录审阅稿：${data.outputPath.trim()}`);
    }
    const mark = openWordCheckMarker(params.ctx.workspaceDir, taskId);
    if (mark) {
      lines.push(mark);
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

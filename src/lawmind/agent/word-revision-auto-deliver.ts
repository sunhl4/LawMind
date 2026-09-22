/**
 * After a Word-revision turn, if the model forgot render_tracked_draft
 * but hunks exist, write the sibling tracked Word anyway — only on a
 * completed writable turn, never while paused, clarifying, or readonly.
 */

import { READONLY_AGENT_TOOL_NAMES, RESEARCH_AGENT_TOOL_NAMES } from "./permission-mode.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { AgentContext, AgentTurn } from "./types.js";

export function shouldAutoDeliverWordRevision(params: {
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
  if (mode === "readonly" || mode === "research") {
    return false;
  }
  const trackedCalls = params.turn.toolNameCallCounts?.render_tracked_draft ?? 0;
  return trackedCalls === 0;
}

export async function autoDeliverWordRevisionIfNeeded(params: {
  ctx: AgentContext;
  registry: ToolRegistry;
  turn: AgentTurn;
}): Promise<string | undefined> {
  if (!shouldAutoDeliverWordRevision({ ctx: params.ctx, turn: params.turn })) {
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
  const result = await tool.execute({}, params.ctx);
  if (!result.ok) {
    return undefined;
  }
  const data = result.data as { message?: string; outputPath?: string } | undefined;
  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  if (typeof data?.outputPath === "string" && data.outputPath.trim()) {
    return `已写出源文件同目录审阅稿：${data.outputPath}`;
  }
  return undefined;
}

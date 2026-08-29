/**
 * After a Word-revision turn, if the model forgot render_tracked_draft
 * but hunks exist, write the sibling tracked Word anyway.
 */

import type { ToolRegistry } from "./tools/registry.js";
import type { AgentContext, AgentTurn } from "./types.js";

export async function autoDeliverWordRevisionIfNeeded(params: {
  ctx: AgentContext;
  registry: ToolRegistry;
  turn: AgentTurn;
}): Promise<string | undefined> {
  if (!params.ctx.wordRevisionTurn) {
    return undefined;
  }
  const trackedCalls = params.turn.toolNameCallCounts?.render_tracked_draft ?? 0;
  if (trackedCalls > 0) {
    return undefined;
  }
  const tool = params.registry.get("render_tracked_draft");
  if (!tool) {
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

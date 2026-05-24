/**
 * Meeting / notify-family tools — W8。
 *
 * 包含：
 *   - notify_assistant：单向发送（fire-and-forget）
 *
 * 拆分自原 collaboration-tools.ts。后续若新增"会议主持/纪要"类工具可放在此文件。
 */

import { randomUUID } from "node:crypto";
import { emitCollaborationEvent } from "../../collaboration/audit.js";
import { fireAndForget } from "../../collaboration/message-bus.js";
import type { AgentTool, AgentConfig } from "../../types.js";
import { listAvailableAssistantNames, resolveAssistantId } from "./utils.js";

export function createNotifyAssistantTool(opts: { baseConfig: AgentConfig }): AgentTool {
  return {
    definition: {
      name: "notify_assistant",
      description: "向另一个助手发送信息通知（不等待回复）。适用于同步状态更新、共享发现等场景。",
      category: "system",
      parameters: {
        target_assistant: {
          type: "string",
          description: "目标助手的 ID 或显示名称",
          required: true,
        },
        message: {
          type: "string",
          description: "要发送的信息内容",
          required: true,
        },
      },
    },
    async execute(params, ctx) {
      const targetInput = params.target_assistant as string;
      const message = params.message as string;

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput, ctx.envFile);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir, ctx.envFile)}`,
        };
      }

      const fromId = ctx.assistantId ?? "unknown";

      emitCollaborationEvent(ctx.workspaceDir, {
        eventId: randomUUID(),
        kind: "notify.sent",
        fromAssistantId: fromId,
        toAssistantId: targetId,
        matterId: ctx.matterId,
        detail: message.slice(0, 120),
        timestamp: new Date().toISOString(),
      });

      fireAndForget({
        baseConfig: opts.baseConfig,
        fromAssistantId: fromId,
        toAssistantId: targetId,
        message,
        matterId: ctx.matterId,
        kind: "notify",
      });

      return {
        ok: true,
        data: {
          targetAssistant: targetId,
          status: "sent",
          note: `信息已发送给「${targetId}」。`,
        },
      };
    },
  };
}

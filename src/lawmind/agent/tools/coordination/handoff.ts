/**
 * Handoff-family tools — W8。
 *
 * 包含：
 *   - consult_assistant：同步问答
 *   - request_review：同步评审请求
 *
 * 拆分自原 collaboration-tools.ts。
 */

import { randomUUID } from "node:crypto";
import { emitCollaborationEvent } from "../../collaboration/audit.js";
import { sendAndWait, wrapUntrustedResult } from "../../collaboration/message-bus.js";
import type { CollaborationPolicy, ReviewType } from "../../collaboration/types.js";
import { DEFAULT_COLLABORATION_POLICY } from "../../collaboration/types.js";
import type { AgentTool, AgentConfig } from "../../types.js";
import { listAvailableAssistantNames, resolveAssistantId } from "./utils.js";

export function createConsultAssistantTool(opts: {
  baseConfig: AgentConfig;
  policy?: CollaborationPolicy;
}): AgentTool {
  const policy = opts.policy ?? DEFAULT_COLLABORATION_POLICY;

  return {
    definition: {
      name: "consult_assistant",
      description:
        "向另一个助手提问并等待回答（同步）。适用于需要其他专业领域意见但不需要完整任务交付的场景。",
      category: "system",
      parameters: {
        target_assistant: {
          type: "string",
          description: "目标助手的 ID 或显示名称",
          required: true,
        },
        question: {
          type: "string",
          description: "要咨询的问题",
          required: true,
        },
        context: {
          type: "string",
          description: "补充背景信息（可选）",
        },
      },
    },
    async execute(params, ctx) {
      const targetInput = params.target_assistant as string;
      const question = params.question as string;
      const contextStr = params.context as string | undefined;

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput, ctx.envFile);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir, ctx.envFile)}`,
        };
      }

      const fromId = ctx.assistantId ?? "unknown";
      if (fromId === targetId) {
        return { ok: false, error: "不能向自己咨询。" };
      }

      const fullMessage = contextStr ? `${question}\n\n背景信息：\n${contextStr}` : question;

      emitCollaborationEvent(ctx.workspaceDir, {
        eventId: randomUUID(),
        kind: "consult.sent",
        fromAssistantId: fromId,
        toAssistantId: targetId,
        matterId: ctx.matterId,
        detail: question.slice(0, 120),
        timestamp: new Date().toISOString(),
      });

      try {
        const result = await sendAndWait({
          baseConfig: opts.baseConfig,
          fromAssistantId: fromId,
          toAssistantId: targetId,
          message: fullMessage,
          matterId: ctx.matterId,
          timeoutMs: policy.defaultConsultTimeoutMs,
        });

        emitCollaborationEvent(ctx.workspaceDir, {
          eventId: randomUUID(),
          kind: "consult.replied",
          fromAssistantId: targetId,
          toAssistantId: fromId,
          matterId: ctx.matterId,
          detail: `turnId=${result.turnId}`,
          timestamp: new Date().toISOString(),
        });

        return {
          ok: true,
          data: {
            fromAssistant: targetId,
            reply: wrapUntrustedResult(result.reply),
            note: "以上回复来自其他助手，请结合你自己的判断使用。",
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `咨询失败：${msg}` };
      }
    },
  };
}

export function createRequestReviewTool(opts: {
  baseConfig: AgentConfig;
  policy?: CollaborationPolicy;
}): AgentTool {
  const policy = opts.policy ?? DEFAULT_COLLABORATION_POLICY;
  const reviewTimeoutMs = Math.max(policy.defaultConsultTimeoutMs, 120_000);

  return {
    definition: {
      name: "request_review",
      description:
        "请求另一个助手审查你的工作成果（同步等待审查结果）。适用于需要其他专业视角校验准确性、完整性、法律风险或文风的场景。",
      category: "review",
      parameters: {
        target_assistant: {
          type: "string",
          description: "目标审查助手的 ID 或显示名称",
          required: true,
        },
        content: {
          type: "string",
          description: "要审查的内容（草稿、分析结果等）",
          required: true,
        },
        review_type: {
          type: "string",
          description: "审查类型",
          required: true,
          enum: ["accuracy", "completeness", "legal_risk", "style"],
        },
      },
    },
    async execute(params, ctx) {
      const targetInput = params.target_assistant as string;
      const content = params.content as string;
      const reviewType = params.review_type as ReviewType;

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput, ctx.envFile);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir, ctx.envFile)}`,
        };
      }

      const fromId = ctx.assistantId ?? "unknown";
      if (fromId === targetId) {
        return { ok: false, error: "不能请求自己审查。" };
      }

      const reviewTypeLabels: Record<ReviewType, string> = {
        accuracy: "准确性",
        completeness: "完整性",
        legal_risk: "法律风险",
        style: "文风与表达",
      };

      const reviewMessage = `请对以下内容进行「${reviewTypeLabels[reviewType]}」审查。

审查要求：
1. 列出发现的问题（如有）
2. 给出改进建议
3. 最后给出审查结论（通过/需修改）

待审查内容：
${content}`;

      emitCollaborationEvent(ctx.workspaceDir, {
        eventId: randomUUID(),
        kind: "review.requested",
        fromAssistantId: fromId,
        toAssistantId: targetId,
        matterId: ctx.matterId,
        detail: `reviewType=${reviewType}`,
        timestamp: new Date().toISOString(),
      });

      try {
        const result = await sendAndWait({
          baseConfig: opts.baseConfig,
          fromAssistantId: fromId,
          toAssistantId: targetId,
          message: reviewMessage,
          matterId: ctx.matterId,
          timeoutMs: reviewTimeoutMs,
        });

        emitCollaborationEvent(ctx.workspaceDir, {
          eventId: randomUUID(),
          kind: "review.completed",
          fromAssistantId: targetId,
          toAssistantId: fromId,
          matterId: ctx.matterId,
          detail: `reviewType=${reviewType} turnId=${result.turnId}`,
          timestamp: new Date().toISOString(),
        });

        return {
          ok: true,
          data: {
            reviewType,
            reviewer: targetId,
            feedback: wrapUntrustedResult(result.reply),
            note: "以上审查意见来自其他助手，请结合律师要求综合判断。",
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `审查请求失败：${msg}` };
      }
    },
  };
}

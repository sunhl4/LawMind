/**
 * Inter-assistant collaboration tools.
 *
 * Four tools that enable assistants to communicate:
 *   - delegate_task: Assign a sub-task to another assistant (async)
 *   - consult_assistant: Ask another assistant a question and wait (sync)
 *   - notify_assistant: Send info to another assistant (fire-and-forget)
 *   - request_review: Ask another assistant to review work (sync)
 *
 * Inspired by reference stack's sessions_send / sessions_spawn tools.
 */

import { randomUUID } from "node:crypto";
import { loadAssistantProfiles } from "../../assistants/store.js";
import { emitCollaborationEvent } from "../collaboration/audit.js";
import {
  registerDelegation,
  markDelegationRunning,
  markDelegationCompleted,
  markDelegationFailed,
  validateDelegation,
  listDelegations,
  getDelegation,
  buildDelegationEvent,
} from "../collaboration/delegation-registry.js";
import { sendAndWait, fireAndForget, wrapUntrustedResult } from "../collaboration/message-bus.js";
import type { CollaborationPolicy, ReviewType } from "../collaboration/types.js";
import { DEFAULT_COLLABORATION_POLICY } from "../collaboration/types.js";
import type { AgentTool, AgentConfig } from "../types.js";

/**
 * Resolve the lawmind root from workspace dir (parent of workspace/).
 */
function lawMindRootFromWorkspace(workspaceDir: string): string {
  return workspaceDir.replace(/[\\/]workspace$/, "") || workspaceDir;
}

/**
 * List available assistant display names for error messages.
 */
function listAvailableAssistantNames(workspaceDir: string): string {
  const root = lawMindRootFromWorkspace(workspaceDir);
  const profiles = loadAssistantProfiles(root);
  return profiles.map((p) => `${p.assistantId} (${p.displayName})`).join(", ");
}

/**
 * Resolve an assistant by ID or display name.
 */
function resolveAssistantId(workspaceDir: string, nameOrId: string): string | undefined {
  const root = lawMindRootFromWorkspace(workspaceDir);
  const profiles = loadAssistantProfiles(root);
  const byId = profiles.find((p) => p.assistantId === nameOrId);
  if (byId) {
    return byId.assistantId;
  }
  const byName = profiles.find(
    (p) => p.displayName === nameOrId || p.displayName.includes(nameOrId),
  );
  return byName?.assistantId;
}

// ─────────────────────────────────────────────
// delegate_task
// ─────────────────────────────────────────────

export function createDelegateTaskTool(opts: {
  baseConfig: AgentConfig;
  policy?: CollaborationPolicy;
  currentDepth?: number;
}): AgentTool {
  const policy = opts.policy ?? DEFAULT_COLLABORATION_POLICY;
  const currentDepth = opts.currentDepth ?? 0;

  return {
    definition: {
      name: "delegate_task",
      description:
        "将一个子任务委派给另一个助手异步执行。目标助手将在独立会话中完成任务，结果会在完成后通知你。适用于需要其他专业岗位处理的工作。",
      category: "system",
      parameters: {
        target_assistant: {
          type: "string",
          description: "目标助手的 ID 或显示名称",
          required: true,
        },
        task: {
          type: "string",
          description: "要委派的任务描述，尽量详细清晰",
          required: true,
        },
        matter_id: {
          type: "string",
          description: "关联案件 ID（可选，默认使用当前案件）",
        },
        priority: {
          type: "string",
          description: "优先级",
          enum: ["normal", "high", "low"],
        },
      },
    },
    async execute(params, ctx) {
      const targetInput = params.target_assistant as string;
      const task = params.task as string;
      const matterId = (params.matter_id as string) || ctx.matterId;
      const priority = (params.priority as "normal" | "high" | "low") || "normal";

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir)}`,
        };
      }

      const fromId = ctx.assistantId ?? "unknown";
      const validationError = validateDelegation({
        fromAssistantId: fromId,
        toAssistantId: targetId,
        depth: currentDepth,
        policy,
      });
      if (validationError) {
        return { ok: false, error: validationError };
      }

      const record = registerDelegation({
        workspaceDir: ctx.workspaceDir,
        fromAssistantId: fromId,
        toAssistantId: targetId,
        task,
        matterId,
        priority,
        depth: currentDepth + 1,
      });

      emitCollaborationEvent(ctx.workspaceDir, buildDelegationEvent(record, "delegation.created"));

      const { completion } = fireAndForget({
        baseConfig: opts.baseConfig,
        fromAssistantId: fromId,
        toAssistantId: targetId,
        message: task,
        matterId,
        kind: "delegate",
      });

      markDelegationRunning(ctx.workspaceDir, record.delegationId, "");

      emitCollaborationEvent(ctx.workspaceDir, buildDelegationEvent(record, "delegation.started"));

      completion
        .then((result) => {
          markDelegationCompleted(ctx.workspaceDir, record.delegationId, result.reply);
          emitCollaborationEvent(
            ctx.workspaceDir,
            buildDelegationEvent(record, "delegation.completed", `turnId=${result.turnId}`),
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          markDelegationFailed(ctx.workspaceDir, record.delegationId, msg);
          emitCollaborationEvent(
            ctx.workspaceDir,
            buildDelegationEvent(record, "delegation.failed", msg),
          );
        });

      return {
        ok: true,
        data: {
          delegationId: record.delegationId,
          targetAssistant: targetId,
          status: "running",
          note: `任务已委派给「${targetId}」，完成后结果会自动回传。委派 ID: ${record.delegationId}`,
        },
      };
    },
  };
}

// ─────────────────────────────────────────────
// consult_assistant
// ─────────────────────────────────────────────

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

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir)}`,
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

// ─────────────────────────────────────────────
// notify_assistant
// ─────────────────────────────────────────────

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

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir)}`,
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

// ─────────────────────────────────────────────
// request_review
// ─────────────────────────────────────────────

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

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir)}`,
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

// ─────────────────────────────────────────────
// list_delegations (status query tool)
// ─────────────────────────────────────────────

export const listDelegationsTool: AgentTool = {
  definition: {
    name: "list_delegations",
    description: "查看当前所有委派任务的状态，包括进行中、已完成和失败的。",
    category: "system",
    parameters: {
      status: {
        type: "string",
        description: "按状态筛选",
        enum: ["pending", "running", "completed", "failed", "timeout", "cancelled"],
      },
    },
  },
  async execute(params, ctx) {
    const status = params.status as string | undefined;
    const records = listDelegations({
      fromAssistantId: ctx.assistantId,
      status: status as
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "timeout"
        | "cancelled"
        | undefined,
    });

    return {
      ok: true,
      data: {
        delegations: records.slice(0, 20).map((r) => ({
          delegationId: r.delegationId,
          toAssistant: r.toAssistantId,
          task: r.task.slice(0, 100),
          status: r.status,
          result: r.result?.slice(0, 200),
          error: r.error,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        })),
        total: records.length,
      },
    };
  },
};

// ─────────────────────────────────────────────
// get_delegation_result
// ─────────────────────────────────────────────

export const getDelegationResultTool: AgentTool = {
  definition: {
    name: "get_delegation_result",
    description: "获取某个委派任务的完整结果。",
    category: "system",
    parameters: {
      delegation_id: {
        type: "string",
        description: "委派 ID",
        required: true,
      },
    },
  },
  async execute(params) {
    const delegationId = params.delegation_id as string;
    const record = getDelegation(delegationId);
    if (!record) {
      return { ok: false, error: `未找到委派记录：${delegationId}` };
    }

    return {
      ok: true,
      data: {
        delegationId: record.delegationId,
        fromAssistant: record.fromAssistantId,
        toAssistant: record.toAssistantId,
        task: record.task,
        status: record.status,
        result: record.result ? wrapUntrustedResult(record.result) : undefined,
        error: record.error,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
    };
  },
};

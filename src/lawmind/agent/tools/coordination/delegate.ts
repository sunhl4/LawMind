/**
 * Delegate-family tools — W8。
 *
 * 包含：
 *   - delegate_task：把子任务委派给指定助手（异步）
 *   - delegate_to_role：W8 新增；按 Role 委派，自动找到该 Role 下可用助手
 *   - list_delegations：列出当前所有委派
 *   - get_delegation_result：获取某次委派的完整结果
 *
 * 拆分自原 collaboration-tools.ts。
 */

import { appendTeamMeetingLinesSync, createTeamMeetingSystemLine } from "../../../cases/index.js";
import { getRoleById } from "../../../core/role.js";
import { emitCollaborationEvent } from "../../collaboration/audit.js";
import {
  registerDelegation,
  markDelegationRunning,
  markDelegationCompleted,
  markDelegationFailed,
  markDelegationTimeout,
  validateDelegation,
  listDelegations,
  getDelegation,
  buildDelegationEvent,
  readDelegationResultFile,
} from "../../collaboration/delegation-registry.js";
import { fireAndForget, wrapUntrustedResult } from "../../collaboration/message-bus.js";
import type { CollaborationPolicy, DelegationRecord } from "../../collaboration/types.js";
import { DEFAULT_COLLABORATION_POLICY } from "../../collaboration/types.js";
import { appendSyntheticAssistantReply } from "../../session.js";
import { requestTurnAbort } from "../../turn-abort.js";
import type { AgentTool, AgentConfig } from "../../types.js";
import { findAssistantsByRole, listAvailableAssistantNames, resolveAssistantId } from "./utils.js";

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
        "将一个子任务委派给另一个助手异步执行。目标助手在**独立会话**中按正常对话与工具链执行（含交付/审核相关任务落盘），完成后**本对话会自动插入一条「委派结果」助手消息**（LawMind 桌面端轮询 + 会话落盘）；律师也可在「协作」页打开该子会话继续指导。也可用 `get_delegation_result` 主动拉取。不要向律师承诺「等对方回复后第一时间人工通知你」——系统会代你回传，你只需如实说明即可。",
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

      const targetId = resolveAssistantId(ctx.workspaceDir, targetInput, ctx.envFile);
      if (!targetId) {
        return {
          ok: false,
          error: `找不到助手「${targetInput}」。可用助手：${listAvailableAssistantNames(ctx.workspaceDir, ctx.envFile)}`,
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

      return startDelegation({
        baseConfig: opts.baseConfig,
        workspaceDir: ctx.workspaceDir,
        fromId,
        toId: targetId,
        task,
        matterId,
        priority,
        depth: currentDepth + 1,
        parentSessionId: ctx.sessionId,
      });
    },
  };
}

function injectDelegationParentFollowUp(
  workspaceDir: string,
  rec: DelegationRecord,
  body: string,
  ok: boolean,
): void {
  const sid = rec.parentSessionId?.trim();
  if (!sid) {
    return;
  }
  const label = ok ? "【委派结果 · 已自动回传】" : "【委派结果 · 未成功】";
  const main = body.trim() || (ok ? "（子助手未返回正文）" : "（无错误详情）");
  const pack =
    `${label}\n- 目标助手：**${rec.toAssistantId}**\n- 委派 ID：\`${rec.delegationId}\`\n- 状态：**${rec.status}**\n\n---\n\n${main}`.slice(
      0,
      48_000,
    );
  appendSyntheticAssistantReply(workspaceDir, sid, pack);
}

/**
 * W8：按 Role 委派。模型只指定目标 Role，executor 自动选取该 Role 下首位可用助手。
 */
export function createDelegateToRoleTool(opts: {
  baseConfig: AgentConfig;
  policy?: CollaborationPolicy;
  currentDepth?: number;
}): AgentTool {
  const policy = opts.policy ?? DEFAULT_COLLABORATION_POLICY;
  const currentDepth = opts.currentDepth ?? 0;

  return {
    definition: {
      name: "delegate_to_role",
      description:
        "按 Role（岗位）委派子任务。系统会自动选择该 Role 下的可用助手承接，避免你硬编码 assistantId。",
      category: "system",
      parameters: {
        role_id: {
          type: "string",
          description: "目标 Role 的 id，如 contract_review / general_litigation 等",
          required: true,
        },
        task: {
          type: "string",
          description: "要委派的任务描述",
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
      const roleId = (params.role_id as string)?.trim();
      const task = params.task as string;
      const matterId = (params.matter_id as string) || ctx.matterId;
      const priority = (params.priority as "normal" | "high" | "low") || "normal";

      const role = getRoleById(roleId);
      if (!role) {
        return { ok: false, error: `未知 Role：${roleId}` };
      }
      const candidates = findAssistantsByRole(ctx.workspaceDir, role.roleId, ctx.envFile);
      if (candidates.length === 0) {
        return {
          ok: false,
          error: `当前工作区没有承担「${role.displayName}」(roleId=${role.roleId}) 的助手。请先在设置里添加。`,
        };
      }
      const fromId = ctx.assistantId ?? "unknown";
      const target = candidates.find((c) => c.assistantId !== fromId) ?? candidates[0];

      const validationError = validateDelegation({
        fromAssistantId: fromId,
        toAssistantId: target.assistantId,
        depth: currentDepth,
        policy,
      });
      if (validationError) {
        return { ok: false, error: validationError };
      }

      return startDelegation({
        baseConfig: opts.baseConfig,
        workspaceDir: ctx.workspaceDir,
        fromId,
        toId: target.assistantId,
        task: `[岗位委派 ${role.displayName}] ${task}`,
        matterId,
        priority,
        depth: currentDepth + 1,
        targetRoleId: role.roleId,
        parentSessionId: ctx.sessionId,
      });
    },
  };
}

/** 真正发起委派（delegate_task、delegate_to_role、桌面 API 共用）。 */
export function startDelegation(args: {
  baseConfig: AgentConfig;
  workspaceDir: string;
  fromId: string;
  toId: string;
  task: string;
  matterId?: string;
  priority: "normal" | "high" | "low";
  depth: number;
  targetRoleId?: string;
  parentSessionId?: string;
}): { ok: true; data: Record<string, unknown> } {
  const record = registerDelegation({
    workspaceDir: args.workspaceDir,
    fromAssistantId: args.fromId,
    toAssistantId: args.toId,
    task: args.task,
    matterId: args.matterId,
    priority: args.priority,
    depth: args.depth,
    parentSessionId: args.parentSessionId,
  });

  emitCollaborationEvent(args.workspaceDir, buildDelegationEvent(record, "delegation.created"));

  const matterForMeeting = typeof args.matterId === "string" ? args.matterId.trim() : "";
  if (matterForMeeting) {
    try {
      appendTeamMeetingLinesSync(args.workspaceDir, matterForMeeting, [
        createTeamMeetingSystemLine({
          text: `协作委派已创建：${args.fromId} → ${args.toId}${args.targetRoleId ? `（按 Role=${args.targetRoleId}）` : ""}。${args.task.slice(0, 600)}${args.task.length > 600 ? "…" : ""}`,
          delegationId: record.delegationId,
        }),
      ]);
    } catch {
      /* ignore disk */
    }
  }

  const timeoutMs = DEFAULT_COLLABORATION_POLICY.defaultDelegationTimeoutMs;
  const { completion, targetSessionId } = fireAndForget({
    baseConfig: args.baseConfig,
    fromAssistantId: args.fromId,
    toAssistantId: args.toId,
    message: args.task,
    matterId: args.matterId,
    kind: "delegate",
    delegationId: record.delegationId,
    collaborationDepth: args.depth + 1,
    permissionMode: args.baseConfig.permissionMode,
    timeoutMs,
    onTimeout: (sid) => {
      markDelegationTimeout(args.workspaceDir, record.delegationId);
      requestTurnAbort(sid);
      emitCollaborationEvent(args.workspaceDir, buildDelegationEvent(record, "delegation.timeout"));
    },
  });
  markDelegationRunning(args.workspaceDir, record.delegationId, targetSessionId);
  emitCollaborationEvent(args.workspaceDir, buildDelegationEvent(record, "delegation.started"));

  completion
    .then((result) => {
      markDelegationCompleted(
        args.workspaceDir,
        record.delegationId,
        result.reply,
        result.sessionId,
      );
      const latest = getDelegation(record.delegationId);
      if (latest) {
        injectDelegationParentFollowUp(
          args.workspaceDir,
          latest,
          latest.result ?? result.reply,
          true,
        );
      }
      emitCollaborationEvent(
        args.workspaceDir,
        buildDelegationEvent(record, "delegation.completed", `turnId=${result.turnId}`),
      );
      const mid = record.matterId?.trim();
      if (mid) {
        try {
          appendTeamMeetingLinesSync(args.workspaceDir, mid, [
            createTeamMeetingSystemLine({
              text: `委派已完成：${args.fromId} → ${args.toId}（${record.delegationId.slice(0, 8)}…）`,
              delegationId: record.delegationId,
            }),
          ]);
        } catch {
          /* ignore disk */
        }
      }
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      markDelegationFailed(args.workspaceDir, record.delegationId, msg);
      const latest = getDelegation(record.delegationId);
      if (latest) {
        injectDelegationParentFollowUp(args.workspaceDir, latest, msg, false);
      }
      emitCollaborationEvent(
        args.workspaceDir,
        buildDelegationEvent(record, "delegation.failed", msg),
      );
      const mid = record.matterId?.trim();
      if (mid) {
        try {
          appendTeamMeetingLinesSync(args.workspaceDir, mid, [
            createTeamMeetingSystemLine({
              text: `委派失败：${args.fromId} → ${args.toId} — ${msg.slice(0, 800)}`,
              delegationId: record.delegationId,
            }),
          ]);
        } catch {
          /* ignore disk */
        }
      }
    });

  return {
    ok: true,
    data: {
      delegationId: record.delegationId,
      targetAssistant: args.toId,
      targetRoleId: args.targetRoleId,
      status: "running",
      note: `任务已委派给「${args.toId}」${args.targetRoleId ? `（Role=${args.targetRoleId}）` : ""}；完成后本对话将**自动出现一条委派结果**（LawMind 桌面），委派 ID: ${record.delegationId}`,
    },
  };
}

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
          fromAssistant: r.fromAssistantId,
          toAssistant: r.toAssistantId,
          matterId: r.matterId,
          parentSessionId: r.parentSessionId,
          targetSessionId: r.targetSessionId,
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
  async execute(params, ctx) {
    const delegationId = params.delegation_id as string;
    const record = getDelegation(delegationId);
    if (!record) {
      return { ok: false, error: `未找到委派记录：${delegationId}` };
    }

    const fullFromDisk = readDelegationResultFile(ctx.workspaceDir, record);
    const resultText = fullFromDisk ?? record.result;

    return {
      ok: true,
      data: {
        delegationId: record.delegationId,
        fromAssistant: record.fromAssistantId,
        toAssistant: record.toAssistantId,
        matterId: record.matterId,
        parentSessionId: record.parentSessionId,
        targetSessionId: record.targetSessionId,
        task: record.task,
        status: record.status,
        result: resultText ? wrapUntrustedResult(resultText) : undefined,
        resultTruncated: record.resultTruncated === true && !fullFromDisk,
        resultPath: record.resultPath,
        error: record.error,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
    };
  },
};

import { requestApproval } from "../../../application/services/approval-service.js";
import { recordDeadline } from "../../../application/services/deadline-service.js";
import { openQueueItem } from "../../../application/services/queue-write-service.js";
import { appendSessionSummary } from "../../../memory/session-summary.js";
import type { AgentTool } from "../../types.js";
import {
  asEnum,
  DEADLINE_SEVERITY_VALUES,
  ensureMatterId,
  QUEUE_KIND_VALUES,
  QUEUE_PRIORITY_VALUES,
  RISK_LEVEL_VALUES,
} from "./engine-governance-shared.js";
import { asNonEmptyString, asOptionalString, MAX_TITLE_LENGTH } from "./engine-tool-shared.js";

export const openWorkQueueItem: AgentTool = {
  definition: {
    name: "open_work_queue_item",
    description:
      "在 matter 工作队列里登记一条待办（如：待补证据、需合伙人审批、可起草、可渲染等）。落到 workspace/matters/<id>/queue.jsonl，作为案件进度的真相源。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（缺省时复用当前会话的 matterId）" },
      kind: {
        type: "string",
        description: "队列条目类型",
        enum: [...QUEUE_KIND_VALUES],
        required: true,
      },
      title: { type: "string", description: "条目标题", required: true },
      detail: { type: "string", description: "可选明细" },
      priority: {
        type: "string",
        description: "优先级（默认 normal）",
        enum: [...QUEUE_PRIORITY_VALUES],
      },
      related_task_id: { type: "string", description: "可选：关联 task ID" },
      related_deliverable_id: { type: "string", description: "可选：关联 deliverable ID" },
    },
  },
  async execute(params, ctx) {
    try {
      const matterId = ensureMatterId(params.matter_id, ctx.matterId);
      const kind = asEnum(params.kind, QUEUE_KIND_VALUES, "kind");
      const title = asNonEmptyString(params.title, "title", MAX_TITLE_LENGTH);
      const detail = asOptionalString(params.detail, "detail", 4000);
      const priority =
        params.priority === undefined
          ? undefined
          : asEnum(params.priority, QUEUE_PRIORITY_VALUES, "priority");
      const relatedTaskId = asOptionalString(params.related_task_id, "related_task_id", 128);
      const relatedDeliverableId = asOptionalString(
        params.related_deliverable_id,
        "related_deliverable_id",
        128,
      );
      const item = openQueueItem(ctx.workspaceDir, {
        matterId,
        kind,
        title,
        detail,
        priority,
        relatedTaskId,
        relatedDeliverableId,
      });
      return {
        ok: true,
        data: {
          queueItemId: item.queueItemId,
          status: item.status,
          priority: item.priority,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `登记队列条目失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const requestApprovalTool: AgentTool = {
  definition: {
    name: "request_approval",
    description:
      "向当前案件的审批队列追加一条 approval（如：需要合伙人复核、客户授权）。落到 workspace/matters/<id>/approvals.jsonl。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（缺省时复用当前会话的 matterId）" },
      deliverable_id: { type: "string", description: "可选：关联 deliverable ID" },
      target_role: { type: "string", description: "目标角色 ID（如 supervising-partner）" },
      risk_level: {
        type: "string",
        description: "风险等级",
        enum: [...RISK_LEVEL_VALUES],
        required: true,
      },
      reason: { type: "string", description: "请求理由（必填）", required: true },
    },
  },
  async execute(params, ctx) {
    try {
      const matterId = ensureMatterId(params.matter_id, ctx.matterId);
      const riskLevel = asEnum(params.risk_level, RISK_LEVEL_VALUES, "risk_level");
      const reason = asNonEmptyString(params.reason, "reason", 4000);
      const targetRole = asOptionalString(params.target_role, "target_role", 96);
      const deliverableId = asOptionalString(params.deliverable_id, "deliverable_id", 128);
      const record = requestApproval(ctx.workspaceDir, {
        matterId,
        deliverableId,
        requestedBy: ctx.actorId,
        requestedRole: undefined,
        targetRole,
        reason,
        riskLevel,
      });
      return {
        ok: true,
        data: {
          approvalId: record.approvalId,
          status: record.status,
          targetRole: record.targetRole,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `请求审批失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const recordDeadlineTool: AgentTool = {
  definition: {
    name: "record_deadline",
    description:
      "记录案件 deadline（提交期限、出庭日、审批截止等），落到 workspace/matters/<id>/deadlines.jsonl。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（缺省时复用当前会话的 matterId）" },
      title: { type: "string", description: "deadline 标题", required: true },
      due_at: { type: "string", description: "ISO8601 时间戳", required: true },
      severity: {
        type: "string",
        description: "严重等级",
        enum: [...DEADLINE_SEVERITY_VALUES],
      },
      notes: { type: "string", description: "可选备注" },
    },
  },
  async execute(params, ctx) {
    try {
      const matterId = ensureMatterId(params.matter_id, ctx.matterId);
      const title = asNonEmptyString(params.title, "title", MAX_TITLE_LENGTH);
      const dueAt = asNonEmptyString(params.due_at, "due_at", 64);
      const severity =
        params.severity === undefined
          ? undefined
          : asEnum(params.severity, DEADLINE_SEVERITY_VALUES, "severity");
      const notes = asOptionalString(params.notes, "notes", 4000);
      const record = recordDeadline(ctx.workspaceDir, {
        matterId,
        title,
        dueAt,
        severity,
        notes,
      });
      return {
        ok: true,
        data: {
          deadlineId: record.deadlineId,
          severity: record.severity,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `记录 deadline 失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const appendSessionSummaryTool: AgentTool = {
  definition: {
    name: "append_session_summary",
    description:
      "将会话要点追加写入 cases/<matter_id>/session-summary.md（仅该路径，供跨轮记忆）。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（缺省时复用当前会话 matterId）" },
      summary: { type: "string", description: "Markdown 摘要片段", required: true },
    },
    isConcurrencySafe: false,
    approvalTemplate: "readonly",
  },
  async execute(params, ctx) {
    try {
      const matterId = ensureMatterId(params.matter_id, ctx.matterId);
      const summary = asNonEmptyString(params.summary, "summary", 12_000);
      const out = appendSessionSummary(ctx.workspaceDir, matterId, summary);
      if (!out.ok) {
        return { ok: false, error: out.error };
      }
      return { ok: true, data: { matterId, path: `cases/${matterId}/session-summary.md` } };
    } catch (err) {
      return {
        ok: false,
        error: `写入会话摘要失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

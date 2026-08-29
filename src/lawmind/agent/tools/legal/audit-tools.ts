/** Task, draft, and audit trail listing tools. */
import path from "node:path";
import { readAllAuditLogs } from "../../../audit/index.js";
import { listDrafts } from "../../../drafts/index.js";
import { listTaskRecords } from "../../../tasks/index.js";
import type { AgentTool } from "../../types.js";

export const listTasks: AgentTool = {
  definition: {
    name: "list_tasks",
    description: "列出工作区中的所有任务记录，支持按案件和状态筛选。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "按案件 ID 筛选" },
      status: {
        type: "string",
        description: "按状态筛选",
        enum: [
          "created",
          "confirmed",
          "researching",
          "researched",
          "drafted",
          "reviewed",
          "rejected",
          "rendered",
        ],
      },
    },
  },
  async execute(params, ctx) {
    let tasks = listTaskRecords(ctx.workspaceDir);
    if (params.matter_id) {
      tasks = tasks.filter((task) => task.matterId === params.matter_id);
    }
    if (params.status) {
      tasks = tasks.filter((task) => task.status === params.status);
    }
    return {
      ok: true,
      data: {
        tasks: tasks.slice(0, 50).map((task) => ({
          taskId: task.taskId,
          kind: task.kind,
          status: task.status,
          summary: task.summary,
          matterId: task.matterId,
          updatedAt: task.updatedAt,
        })),
        total: tasks.length,
      },
    };
  },
};

export const listAllDrafts: AgentTool = {
  definition: {
    name: "list_drafts",
    description: "列出工作区中的所有草稿，支持按案件筛选。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "按案件 ID 筛选" },
    },
  },
  async execute(params, ctx) {
    let drafts = listDrafts(ctx.workspaceDir);
    if (params.matter_id) {
      drafts = drafts.filter((draft) => draft.matterId === params.matter_id);
    }
    return {
      ok: true,
      data: {
        drafts: drafts.slice(0, 30).map((draft) => ({
          taskId: draft.taskId,
          title: draft.title,
          templateId: draft.templateId,
          reviewStatus: draft.reviewStatus,
          matterId: draft.matterId,
          createdAt: draft.createdAt,
        })),
        total: drafts.length,
      },
    };
  },
};

export const getAuditTrail: AgentTool = {
  definition: {
    name: "get_audit_trail",
    description: "读取审计日志，支持按案件或任务筛选。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "按案件筛选（需先获取该案件的任务列表）" },
      task_id: { type: "string", description: "按任务 ID 筛选" },
    },
  },
  async execute(params, ctx) {
    const auditDir = path.join(ctx.workspaceDir, "audit");
    let events = await readAllAuditLogs(auditDir);
    if (params.task_id) {
      events = events.filter((event) => event.taskId === params.task_id);
    } else if (params.matter_id) {
      const taskIds = new Set(
        listTaskRecords(ctx.workspaceDir)
          .filter((task) => task.matterId === params.matter_id)
          .map((task) => task.taskId),
      );
      events = events.filter((event) => taskIds.has(event.taskId));
    }
    return {
      ok: true,
      data: {
        events: events.slice(-50).map((event) => ({
          kind: event.kind,
          actor: event.actor,
          detail: event.detail,
          timestamp: event.timestamp,
          taskId: event.taskId,
        })),
        total: events.length,
      },
    };
  },
};

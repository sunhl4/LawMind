/**
 * LawMind 法律工具集
 *
 * 每个工具是 agent 可调用的一个能力单元。
 * agent runtime 通过 ToolRegistry 按名称查找和调度。
 *
 * 工具分类：
 *   search   — 检索法规、案例、案件记忆
 *   analyze  — 合同分析、条款比对、引用校验
 *   draft    — 起草章节、整理结论
 *   matter   — 案件管理、添加笔记、标记风险
 *   review   — 请求律师审核、提交审批
 *   system   — 读取配置、查看状态
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readAllAuditLogs } from "../../audit/index.js";
import {
  buildMatterIndex,
  listMatterIds,
  searchMatterIndex,
  summarizeMatterIndex,
} from "../../cases/index.js";
import { listDrafts } from "../../drafts/index.js";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseProgress,
  appendCaseRiskNote,
  appendCaseTaskGoal,
  caseFilePath,
  ensureCaseWorkspace,
  loadMemoryContext,
} from "../../memory/index.js";
import { listTaskRecords } from "../../tasks/index.js";
import type { AgentTool } from "../types.js";
import { engineTools } from "./engine-tools.js";
import { ToolRegistry } from "./registry.js";

async function readSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────
// Search Tools
// ─────────────────────────────────────────────

const searchMatter: AgentTool = {
  definition: {
    name: "search_matter",
    description: "在当前案件的所有记录中搜索关键词，包括争点、风险、任务、草稿、审计事件。",
    category: "search",
    parameters: {
      query: { type: "string", description: "搜索关键词", required: true },
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID，请先关联案件或传入 matter_id。" };
    }
    const index = await buildMatterIndex(ctx.workspaceDir, matterId);
    const hits = searchMatterIndex(index, params.query as string);
    return {
      ok: true,
      data: { matterId, query: params.query, hits: hits.slice(0, 20), total: hits.length },
    };
  },
};

const searchWorkspace: AgentTool = {
  definition: {
    name: "search_workspace",
    description: "搜索工作区文件内容（MEMORY.md、LAWYER_PROFILE.md、案件档案等）。",
    category: "search",
    parameters: {
      query: { type: "string", description: "搜索关键词", required: true },
    },
  },
  async execute(params, ctx) {
    const memory = await loadMemoryContext(ctx.workspaceDir, { matterId: ctx.matterId });
    const query = (params.query as string).toLowerCase();
    const results: Array<{ source: string; snippet: string }> = [];

    for (const [source, content] of Object.entries({
      "MEMORY.md": memory.general,
      "LAWYER_PROFILE.md": memory.profile,
      "CASE.md": memory.caseMemory,
      "today-log": memory.todayLog,
    })) {
      if (!content) {
        continue;
      }
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.toLowerCase().includes(query)) {
          results.push({ source, snippet: line.trim().slice(0, 200) });
        }
      }
    }

    return {
      ok: true,
      data: { query: params.query, results: results.slice(0, 30), total: results.length },
    };
  },
};

// ─────────────────────────────────────────────
// Matter Management Tools
// ─────────────────────────────────────────────

const getMatterSummary: AgentTool = {
  definition: {
    name: "get_matter_summary",
    description: "获取案件摘要，包括核心争点、风险、进展、产物、任务状态。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID。" };
    }
    const index = await buildMatterIndex(ctx.workspaceDir, matterId);
    const summary = summarizeMatterIndex(index);
    return {
      ok: true,
      data: {
        matterId,
        summary,
        coreIssues: index.coreIssues,
        riskNotes: index.riskNotes,
        artifacts: index.artifacts,
        openTasks: index.openTasks.length,
        renderedTasks: index.renderedTasks.length,
      },
    };
  },
};

const listMatters: AgentTool = {
  definition: {
    name: "list_matters",
    description: "列出所有案件 ID。",
    category: "matter",
    parameters: {},
  },
  async execute(_params, ctx) {
    const ids = await listMatterIds(ctx.workspaceDir);
    return { ok: true, data: { matters: ids } };
  },
};

const readCaseFile: AgentTool = {
  definition: {
    name: "read_case_file",
    description: "读取案件的 CASE.md 完整内容。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID。" };
    }
    const filePath = caseFilePath(ctx.workspaceDir, matterId);
    const content = await readSafe(filePath);
    if (!content) {
      return { ok: false, error: `案件 ${matterId} 的 CASE.md 不存在或为空。` };
    }
    return { ok: true, data: { matterId, content } };
  },
};

const addCaseNote: AgentTool = {
  definition: {
    name: "add_case_note",
    description: "向案件的指定章节添加一条记录（争点/风险/进展/产物/任务目标）。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
      section: {
        type: "string",
        description: "目标章节",
        required: true,
        enum: ["core_issue", "risk", "progress", "artifact", "task_goal"],
      },
      content: { type: "string", description: "要添加的内容", required: true },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID。" };
    }
    const section = params.section as string;
    const content = params.content as string;
    await ensureCaseWorkspace(ctx.workspaceDir, matterId);

    const writers: Record<string, (ws: string, mid: string, text: string) => Promise<void>> = {
      core_issue: appendCaseCoreIssue,
      risk: appendCaseRiskNote,
      progress: appendCaseProgress,
      artifact: appendCaseArtifact,
      task_goal: appendCaseTaskGoal,
    };

    const writer = writers[section];
    if (!writer) {
      return { ok: false, error: `未知章节：${section}` };
    }
    await writer(ctx.workspaceDir, matterId, content);
    return { ok: true, data: { matterId, section, content } };
  },
};

// ─────────────────────────────────────────────
// Analyze Tools
// ─────────────────────────────────────────────

const analyzeDocument: AgentTool = {
  definition: {
    name: "analyze_document",
    description: "读取工作区中的指定文件，返回内容供后续分析。支持 Markdown、txt、合同文本等。",
    category: "analyze",
    parameters: {
      file_path: { type: "string", description: "相对于工作区的文件路径", required: true },
    },
  },
  async execute(params, ctx) {
    const filePath = path.resolve(ctx.workspaceDir, params.file_path as string);
    if (!filePath.startsWith(ctx.workspaceDir)) {
      return { ok: false, error: "不允许读取工作区外的文件。" };
    }
    const content = await readSafe(filePath);
    if (!content) {
      return { ok: false, error: `文件不存在或为空：${String(params.file_path)}` };
    }
    return {
      ok: true,
      data: {
        filePath: params.file_path,
        content: content.slice(0, 8000),
        truncated: content.length > 8000,
      },
    };
  },
};

// ─────────────────────────────────────────────
// Draft Tools
// ─────────────────────────────────────────────

const writeDocument: AgentTool = {
  definition: {
    name: "write_document",
    description: "将内容写入工作区的指定文件。用于保存分析结果、草稿等。",
    category: "draft",
    parameters: {
      file_path: { type: "string", description: "相对于工作区的文件路径", required: true },
      content: { type: "string", description: "要写入的内容", required: true },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const filePath = path.resolve(ctx.workspaceDir, params.file_path as string);
    if (!filePath.startsWith(ctx.workspaceDir)) {
      return { ok: false, error: "不允许写入工作区外的文件。" };
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.content as string, "utf8");
    return {
      ok: true,
      data: { filePath: params.file_path, bytes: (params.content as string).length },
    };
  },
};

// ─────────────────────────────────────────────
// System / Status Tools
// ─────────────────────────────────────────────

const listTasks: AgentTool = {
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

const listAllDrafts: AgentTool = {
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

const getAuditTrail: AgentTool = {
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

// ─────────────────────────────────────────────
// Registry Builder
// ─────────────────────────────────────────────

export function createLegalToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const tools: AgentTool[] = [
    // 信息检索
    searchMatter,
    searchWorkspace,
    // 案件管理
    getMatterSummary,
    listMatters,
    readCaseFile,
    addCaseNote,
    // 文件操作
    analyzeDocument,
    writeDocument,
    // 状态查看
    listTasks,
    listAllDrafts,
    getAuditTrail,
    // Engine 桥接 — agent 的"双手"
    ...engineTools,
  ];

  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}

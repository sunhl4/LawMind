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
import type { AgentConfig, AgentTool } from "../types.js";
import {
  createDelegateTaskTool,
  createConsultAssistantTool,
  createNotifyAssistantTool,
  createRequestReviewTool,
  listDelegationsTool,
  getDelegationResultTool,
} from "./collaboration-tools.js";
import { engineTools } from "./engine-tools.js";
import { lawMindWebSearchTool } from "./lawmind-web-search.js";
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

const STATUTE_LINE =
  /《[^》]+》|法典|法律适用|第\s*[零一二三四五六七八九十百千0-9]+条|法规|条例|司法解释|刑法|民法|行政诉讼法|公司法|劳动合同法/i;

const searchStatute: AgentTool = {
  definition: {
    name: "search_statute",
    description:
      "在工作区记忆与案件摘要中检索与法律法规、条文编号相关的内容（启发式：法条、法规名称等）。不替代正式法规库。",
    category: "search",
    parameters: {
      query: { type: "string", description: "关键词（如法律名称、条款主题）", required: true },
      matter_id: { type: "string", description: "可选：限定某案件的 CASE 与索引" },
    },
  },
  async execute(params, ctx) {
    const query = ((params.query as string) ?? "").trim().toLowerCase();
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const matterId = (params.matter_id as string | undefined) || ctx.matterId;
    const results: Array<{ source: string; snippet: string }> = [];

    const pushIfStatute = (source: string, line: string) => {
      const t = line.trim();
      if (!t) {
        return;
      }
      const hitQuery = t.toLowerCase().includes(query);
      const hitStatute = STATUTE_LINE.test(t);
      if (!hitQuery && !hitStatute) {
        return;
      }
      results.push({ source, snippet: t.slice(0, 240) });
    };

    if (matterId) {
      const index = await buildMatterIndex(ctx.workspaceDir, matterId);
      for (const line of index.caseMemory.split("\n")) {
        pushIfStatute(`CASE:${matterId}`, line);
      }
      for (const arr of [
        index.coreIssues,
        index.taskGoals,
        index.riskNotes,
        index.progressEntries,
      ] as const) {
        for (const entry of arr) {
          for (const line of entry.split("\n")) {
            pushIfStatute(`index:${matterId}`, line);
          }
        }
      }
    } else {
      const memory = await loadMemoryContext(ctx.workspaceDir, { matterId: ctx.matterId });
      for (const [source, content] of Object.entries({
        "MEMORY.md": memory.general,
        "LAWYER_PROFILE.md": memory.profile,
        "today-log": memory.todayLog,
      })) {
        if (!content) {
          continue;
        }
        for (const line of content.split("\n")) {
          pushIfStatute(source, line);
        }
      }
    }

    return {
      ok: true,
      data: {
        query: params.query,
        matterId: matterId ?? null,
        hits: results.slice(0, 25),
        total: results.length,
        note: "结果为工作区启发式检索，引用前请核对官方法规文本。",
      },
    };
  },
};

const CASE_LINE =
  /案号|判决书|裁定书|人民法院|高院|中院|最高人民法院|仲裁委|\(\s*20\d{2}\s*\)|民终|民初|刑终|执异|行诉/i;

const searchCaseLaw: AgentTool = {
  definition: {
    name: "search_case_law",
    description:
      "在工作区案件摘要与记忆中检索裁判文书、案号、法院名称等案例线索（启发式）。不替代裁判文书网等专业库。",
    category: "search",
    parameters: {
      query: {
        type: "string",
        description: "关键词（案号片段、对方名称、法院名等）",
        required: true,
      },
      matter_id: { type: "string", description: "可选：限定案件" },
    },
  },
  async execute(params, ctx) {
    const query = ((params.query as string) ?? "").trim().toLowerCase();
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const matterId = (params.matter_id as string | undefined) || ctx.matterId;
    const results: Array<{ source: string; snippet: string }> = [];

    const pushIfCase = (source: string, line: string) => {
      const t = line.trim();
      if (!t) {
        return;
      }
      const hitQuery = t.toLowerCase().includes(query);
      const hitCase = CASE_LINE.test(t);
      if (!hitQuery && !hitCase) {
        return;
      }
      results.push({ source, snippet: t.slice(0, 240) });
    };

    if (matterId) {
      const index = await buildMatterIndex(ctx.workspaceDir, matterId);
      for (const line of index.caseMemory.split("\n")) {
        pushIfCase(`CASE:${matterId}`, line);
      }
      for (const draft of index.drafts) {
        const blob = `${draft.title}\n${draft.sections.map((s) => s.body).join("\n")}`;
        for (const line of blob.split("\n")) {
          pushIfCase(`draft:${draft.taskId}`, line);
        }
      }
    } else {
      const ids = await listMatterIds(ctx.workspaceDir);
      for (const mid of ids.slice(0, 20)) {
        const index = await buildMatterIndex(ctx.workspaceDir, mid);
        for (const line of index.caseMemory.split("\n")) {
          pushIfCase(`CASE:${mid}`, line);
        }
      }
    }

    return {
      ok: true,
      data: {
        query: params.query,
        matterId: matterId ?? null,
        hits: results.slice(0, 25),
        total: results.length,
        note: "结果为工作区线索汇总，正式引用请核实原始裁判文书。",
      },
    };
  },
};

const checkConflictOfInterest: AgentTool = {
  definition: {
    name: "check_conflict_of_interest",
    description:
      "根据当事人/实体名称在工作区已有案件中做字符串命中筛查，提示可能的多案并存或利益冲突风险（需律师最终判断）。",
    category: "matter",
    parameters: {
      parties: {
        type: "string",
        description: "待核查的当事人或实体名称，逗号/顿号分隔",
        required: true,
      },
    },
  },
  async execute(params, ctx) {
    const raw = (params.parties as string) ?? "";
    const parties = raw
      .split(/[,，、;；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (parties.length === 0) {
      return { ok: false, error: "请提供至少 2 个字符以上的当事人名称。" };
    }

    const ids = await listMatterIds(ctx.workspaceDir);
    const partyToMatters = new Map<string, string[]>();

    for (const party of parties) {
      const hits: string[] = [];
      const pl = party.toLowerCase();
      for (const matterId of ids) {
        const index = await buildMatterIndex(ctx.workspaceDir, matterId);
        const blob = [
          index.caseMemory,
          ...index.coreIssues,
          ...index.taskGoals,
          ...index.riskNotes,
          ...index.progressEntries,
        ]
          .join("\n")
          .toLowerCase();
        if (blob.includes(pl)) {
          hits.push(matterId);
        }
      }
      const memory = await loadMemoryContext(ctx.workspaceDir, {});
      const memBlob = [memory.general, memory.profile].join("\n").toLowerCase();
      if (memBlob.includes(pl)) {
        hits.push("(workspace-memory)");
      }
      if (hits.length > 0) {
        partyToMatters.set(party, [...new Set(hits)]);
      }
    }

    const flags: string[] = [];
    for (const [party, matters] of partyToMatters) {
      if (matters.length > 1) {
        flags.push(
          `「${party}」在多个来源中出现：${matters.join("、")} — 请核对是否构成利益冲突。`,
        );
      }
    }

    return {
      ok: true,
      data: {
        parties,
        matches: Object.fromEntries(partyToMatters),
        conflictFlags: flags,
        matterScanned: ids.length,
        note:
          flags.length === 0
            ? "未发现明显的跨案件同名命中，但仍需结合所知客户关系人工确认。"
            : "发现跨来源命中，建议按事务所利益冲突规程复核。",
      },
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

export function createLegalToolRegistry(opts?: {
  allowWebSearch?: boolean;
  enableCollaboration?: boolean;
  baseConfig?: AgentConfig;
  collaborationDepth?: number;
}): ToolRegistry {
  const registry = new ToolRegistry();
  const tools: AgentTool[] = [
    // 信息检索
    searchMatter,
    searchWorkspace,
    searchStatute,
    searchCaseLaw,
    // 案件管理
    getMatterSummary,
    listMatters,
    checkConflictOfInterest,
    readCaseFile,
    addCaseNote,
    // 文件操作
    analyzeDocument,
    writeDocument,
    // 状态查看
    listTasks,
    listAllDrafts,
    getAuditTrail,
  ];

  if (opts?.allowWebSearch) {
    tools.push(lawMindWebSearchTool);
  }

  if (opts?.enableCollaboration && opts.baseConfig) {
    tools.push(
      createDelegateTaskTool({
        baseConfig: opts.baseConfig,
        currentDepth: opts.collaborationDepth ?? 0,
      }),
      createConsultAssistantTool({ baseConfig: opts.baseConfig }),
      createNotifyAssistantTool({ baseConfig: opts.baseConfig }),
      createRequestReviewTool({ baseConfig: opts.baseConfig }),
      listDelegationsTool,
      getDelegationResultTool,
    );
  }

  tools.push(...engineTools);

  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}

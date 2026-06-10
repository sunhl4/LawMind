/** Matter summary, listing, case file, and notes tools. */
import { buildMatterIndex, listMatterIds, summarizeMatterIndex } from "../../../cases/index.js";
import { caseFilePath } from "../../../memory/index.js";
import { writeCaseMemorySection, type CaseMemorySection } from "../../../memory/write-gateway.js";
import type { AgentTool } from "../../types.js";
import { readSafe } from "./ingest-helpers.js";

export const getMatterSummary: AgentTool = {
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

export const listMatters: AgentTool = {
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

export const readCaseFile: AgentTool = {
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

export const addCaseNote: AgentTool = {
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
    const section = params.section as CaseMemorySection;
    const content = params.content as string;
    if (!["core_issue", "risk", "progress", "artifact", "task_goal"].includes(section)) {
      return { ok: false, error: `未知章节：${section}` };
    }
    await writeCaseMemorySection({
      workspaceDir: ctx.workspaceDir,
      matterId,
      section,
      content,
      trackAdoption: true,
      origin: "agent",
    });
    return { ok: true, data: { matterId, section, content } };
  },
};

// ─────────────────────────────────────────────
// Analyze Tools
// ─────────────────────────────────────────────

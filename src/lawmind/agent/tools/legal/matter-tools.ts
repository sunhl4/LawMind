/** Matter summary, listing, case file, and notes tools. */
import { buildMatterIndex, listMatterIds, summarizeMatterIndex } from "../../../cases/index.js";
import { caseFilePath } from "../../../memory/index.js";
import { writeCaseMemorySection, type CaseMemorySection } from "../../../memory/write-gateway.js";
import type { AgentTool } from "../../types.js";
import { matterRequiredResult } from "../matter-required.js";
import { readSafe, sliceDocumentPage } from "./ingest-helpers.js";

const CASE_FILE_DEFAULT_CHARS = 8_000;
const CASE_FILE_MAX_CHARS = 40_000;

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
      return matterRequiredResult(ctx.workspaceDir);
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
    description:
      "读取案件 CASE.md。默认只返回前一段窗口；hasMore=true 时用 offset 续读，不要一次拉全文。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
      offset: { type: "number", description: "从第几个字符开始（默认 0）" },
      limit: { type: "number", description: "本页最多字符（默认 8000）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const filePath = caseFilePath(ctx.workspaceDir, matterId);
    const content = await readSafe(filePath);
    if (!content) {
      return { ok: false, error: `案件 ${matterId} 的 CASE.md 不存在或为空。` };
    }
    const page = sliceDocumentPage(content, params.offset, params.limit, {
      defaultLimit: CASE_FILE_DEFAULT_CHARS,
      maxLimit: CASE_FILE_MAX_CHARS,
    });
    return {
      ok: true,
      data: {
        matterId,
        content: page.content,
        totalChars: page.totalChars,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
      },
    };
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
      return matterRequiredResult(ctx.workspaceDir);
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

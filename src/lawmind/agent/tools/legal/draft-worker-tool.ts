import { DRAFT_WORKER_TOOL_NAME, runDraftWorker } from "../../draft-worker.js";
import type { AgentTool } from "../../types.js";

export const draftWorkerTool: AgentTool = {
  definition: {
    name: DRAFT_WORKER_TOOL_NAME,
    description:
      "并行写稿工：根据任务书起草一份文书片段。子会话看不到对话历史，必须传入自包含任务书。工会自己读 path/钉选源文件，并可用只读工具（list_dir / analyze_document / search_statute / search_case_law）。返回草稿片段、引用出处和待补缺口。不要用于改原件。多章可并行多次调用，由父会话汇总后再 draft_document。",
    category: "draft",
    parameters: {
      goal: {
        type: "string",
        description: "要做的事（自包含，不要只写「帮我看看」）",
        required: true,
      },
      not_goal: {
        type: "string",
        description: "明确不要做的事，例如合同审查、审阅痕迹稿",
      },
      materials: {
        type: "string",
        description: "材料线索（文件夹名、钉选路径）",
      },
      excerpt: {
        type: "string",
        description: "已读材料的摘录正文（父会话写入；有 path 时工自己会再读文件）",
      },
      path: {
        type: "string",
        description: "源文件或文件夹路径。工会自己读 .docx/.pdf/.txt，不要只传文件名却不给正文。",
      },
      section: {
        type: "string",
        description: "要起草的章节名，例如「违约金」「管辖」",
      },
      style: {
        type: "string",
        description: "文风要求，例如「简洁」「正式」",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const goal = typeof params.goal === "string" ? params.goal : "";
    const notGoal = typeof params.not_goal === "string" ? params.not_goal : undefined;
    const materials = typeof params.materials === "string" ? params.materials : undefined;
    const excerpt = typeof params.excerpt === "string" ? params.excerpt : undefined;
    const path = typeof params.path === "string" ? params.path : undefined;
    const section = typeof params.section === "string" ? params.section : undefined;
    const style = typeof params.style === "string" ? params.style : undefined;
    return runDraftWorker({ goal, notGoal, materials, excerpt, path, section, style }, ctx);
  },
};

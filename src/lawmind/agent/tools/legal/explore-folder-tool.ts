import { EXPLORE_FOLDER_TOOL_NAME, runFolderExplorer } from "../../explore-folder-worker.js";
import type { AgentTool } from "../../types.js";

export const exploreFolderTool: AgentTool = {
  definition: {
    name: EXPLORE_FOLDER_TOOL_NAME,
    description:
      "只读探查文件夹（法律版 Explore）。子会话看不到对话历史，必须传入自包含任务书：goal（要做）、not_goal（不要做）、path（目录）。返回目录树、候选文件和摘录。提到文件夹时先调用本工具，不要未读就 apply_surgical_edits / render_tracked_draft。",
    category: "search",
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
      path: {
        type: "string",
        description: "目录路径。可省略：使用钉选目录、【文件夹名】或项目根。",
      },
      materials: {
        type: "string",
        description: "材料线索（文件夹名、钉选路径）",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const goal = typeof params.goal === "string" ? params.goal : "";
    const notGoal = typeof params.not_goal === "string" ? params.not_goal : undefined;
    const path = typeof params.path === "string" ? params.path : undefined;
    const materials = typeof params.materials === "string" ? params.materials : undefined;
    return runFolderExplorer(ctx, { goal, notGoal, path, materials });
  },
};

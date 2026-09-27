import {
  DIGEST_MATERIALS_TOOL_NAME,
  DIGEST_MAX_FILES,
  digestMaterialPile,
} from "../../material-pile-digest.js";
import type { AgentTool } from "../../types.js";

export const digestMaterialsTool: AgentTool = {
  definition: {
    name: DIGEST_MATERIALS_TOOL_NAME,
    description:
      "每份只要一段短摘要时，一次分头读很多份材料并只交回卡片。文件多不是派多个子工的理由。每一份本身要连读、连查、再写时，不要用本工具代替 draft_worker。长文保留头尾，图片会识别文字（本页有上限）。引用必须整段出现在该文件正文里。suggestedEvents 可原样交给 apply_legal_events 的 events；suggestedReviewRows 可原样交给 review_table_update 的 add_rows。本工具不写档案、不导出。读不完用 nextOffset。",
    category: "search",
    parameters: {
      goal: {
        type: "string",
        description: "要从这些材料里抽出什么（自包含，不要只写「帮我看看」）",
        required: true,
      },
      not_goal: {
        type: "string",
        description: "明确不要做的事，例如不要改原件、不要写法律意见",
      },
      path: {
        type: "string",
        description: "目录路径。省略时：有钉选文件就读那些文件，否则用钉选目录或工作区。",
      },
      paths: {
        type: "array",
        description: "要读的文件路径列表。有此项时不再扫整个目录。",
        items: { type: "string" },
      },
      offset: {
        type: "number",
        description: "跳过前 N 个文件，用于 notRead 续读。",
      },
      max_files: {
        type: "number",
        description: `本次最多读几份（默认并上限 ${DIGEST_MAX_FILES}）。`,
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const paths = Array.isArray(params.paths)
      ? params.paths.filter((item): item is string => typeof item === "string")
      : undefined;
    return digestMaterialPile(ctx, {
      goal: typeof params.goal === "string" ? params.goal : "",
      notGoal: typeof params.not_goal === "string" ? params.not_goal : undefined,
      path: typeof params.path === "string" ? params.path : undefined,
      paths,
      offset: typeof params.offset === "number" ? params.offset : undefined,
      maxFiles: typeof params.max_files === "number" ? params.max_files : undefined,
    });
  },
};

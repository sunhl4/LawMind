/**
 * Codex-style `update_plan`: bounded checklist, not a legal pipeline.
 */

import {
  UPDATE_PLAN_TOOL_NAME,
  turnPlanProgress,
  validateUpdatePlanArgs,
} from "../../turn-plan.js";
import type { AgentTool } from "../../types.js";

export const updatePlanTool: AgentTool = {
  definition: {
    name: UPDATE_PLAN_TOOL_NAME,
    description:
      "更新本轮可见办理清单与工作任务书。步骤 2–8 条；同时写入 goal / not_goal / materials / done（要做、不要做、材料、完成标准）。未完成时必须恰好一步 in_progress。开放多步任务先写任务书再动改稿工具。单次问答不要用。回复里不要复述整张清单。",
    category: "system",
    parameters: {
      plan: {
        type: "array",
        description:
          "步骤数组。每项 { step: 短句, status: pending|in_progress|completed }。同时最多一步 in_progress。",
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            step: { type: "string", description: "一句短目标（建议不超过 36 字）" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "pending | in_progress | completed",
            },
          },
          required: ["step", "status"],
        },
      },
      explanation: {
        type: "string",
        description: "仅在中途改计划时说明原因（一句）。",
      },
      goal: {
        type: "string",
        description: "要做：本轮任务（以律师原话为准，一句）。",
      },
      not_goal: {
        type: "string",
        description: "不要做：律师排除的事项，例如合同审查、审阅痕迹稿。",
      },
      materials: {
        type: "string",
        description: "材料在哪：文件夹名、钉选路径；提到目录时写明先 explore_folder。",
      },
      done: {
        type: "string",
        description: "完成标准：怎样才算交差；未读材料不得改稿。",
      },
    },
    isConcurrencySafe: false,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const parsed = validateUpdatePlanArgs(params);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    ctx.pendingTurnPlan = parsed.plan;
    const { completed, total } = turnPlanProgress(parsed.plan);
    return {
      ok: true,
      data: {
        message: `清单已更新（${completed}/${total}）`,
        plan: parsed.plan,
      },
    };
  },
};

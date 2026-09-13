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
      "更新本轮可见办理清单（2–8 步，建议 3–8）。每步一句短目标，status 为 pending / in_progress / completed；未完成时必须恰好一步 in_progress。用于「帮我审这份合同」这类开放多步任务，写入 world-state，避免工具配额里迷航。单次问答不要用。不要与 plan_task、execute_workflow 或「先计划」交接混淆。回复里不要复述整张清单。",
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

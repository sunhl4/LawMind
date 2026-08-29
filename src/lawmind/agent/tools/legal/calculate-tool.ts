import type { AgentTool } from "../../types.js";
import { calculateLegal } from "./calculate-lib.js";

export const calculateTool: AgentTool = {
  definition: {
    name: "calculate",
    description:
      "确定性法律计算，结果带公式与输入便于入卷。op：interest / interest_lpr / date_span / limitation / column_sum / weighted_average / liquidated_damages。LPR 分段利率必须由律师提供。",
    category: "analyze",
    parameters: {
      op: {
        type: "string",
        description:
          "interest | interest_lpr | date_span | limitation | column_sum | weighted_average | liquidated_damages",
        required: true,
        enum: [
          "interest",
          "interest_lpr",
          "date_span",
          "limitation",
          "column_sum",
          "weighted_average",
          "liquidated_damages",
        ],
      },
      inputs: {
        type: "object",
        description: "与 op 对应的输入（本金、日期、数组等）",
        required: true,
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params) {
    const op = typeof params.op === "string" ? params.op.trim() : "";
    const inputs =
      params.inputs && typeof params.inputs === "object" && !Array.isArray(params.inputs)
        ? (params.inputs as Record<string, unknown>)
        : {};
    const computed = calculateLegal(op, inputs);
    if (!computed.ok) {
      return { ok: false, error: computed.error };
    }
    return { ok: true, data: computed.result };
  },
};

/**
 * Disclose extra tools for the current session without rewriting the static prompt prefix.
 */

import { isAnalysisScriptsAllowed } from "../../../policy/analysis-scripts.js";
import type { AgentTool } from "../../types.js";
import {
  CORE_MODEL_TOOL_NAMES,
  DISCLOSED_TOOL_HINTS,
  LIST_MORE_TOOLS_NAME,
} from "../governance.js";

const CORE_SET = new Set<string>(CORE_MODEL_TOOL_NAMES);

export const listMoreTools: AgentTool = {
  definition: {
    name: LIST_MORE_TOOLS_NAME,
    description:
      "列出本轮可临时启用的更多能力；传入 name 后即可在本会话调用该工具（不改常用工具目录）。",
    category: "system",
    parameters: {
      name: {
        type: "string",
        description: "要启用的能力名称，例如 execute_workflow。省略则只返回目录。",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const allowScripts = ctx?.workspaceDir ? isAnalysisScriptsAllowed(ctx.workspaceDir) : false;
    const catalog = DISCLOSED_TOOL_HINTS.filter(
      (row) => row.name !== "run_analysis" || allowScripts,
    ).map((row) => ({
      name: row.name,
      hint: row.hint,
    }));
    const raw = typeof params.name === "string" ? params.name.trim() : "";
    if (!raw) {
      return {
        ok: true,
        data: {
          tools: catalog,
          message: "需要某项能力时再传入 name，本会话即可调用。",
        },
      };
    }
    if (CORE_SET.has(raw) || raw === LIST_MORE_TOOLS_NAME) {
      return {
        ok: true,
        data: {
          alreadyAvailable: true,
          name: raw,
          message: "该能力已在常用工具中，直接调用即可。",
        },
      };
    }
    const hit = catalog.find((row) => row.name === raw);
    if (!hit) {
      return {
        ok: false,
        error: "没有这项可披露能力",
        data: { tools: catalog },
      };
    }
    return {
      ok: true,
      data: {
        disclosedName: hit.name,
        hint: hit.hint,
        message: `已启用：${hit.hint}`,
      },
    };
  },
};

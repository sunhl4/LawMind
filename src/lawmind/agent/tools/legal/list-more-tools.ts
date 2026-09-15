/**
 * Disclose extra tools for the current session without rewriting the static prompt prefix.
 */

import { isAnalysisScriptsAllowed, isHighSecurityMode } from "../../../policy/analysis-scripts.js";
import type { AgentTool } from "../../types.js";
import {
  CORE_MODEL_TOOL_NAMES,
  DISCLOSED_TOOL_HINTS,
  LIST_MORE_TOOLS_NAME,
  UPDATE_PLAN_TOOL_NAME,
} from "../governance.js";

const CORE_SET = new Set<string>(CORE_MODEL_TOOL_NAMES);
const WEB_SEARCH_TOOL_NAMES = new Set(["web_search", "search_statute_web", "url_dossier"]);

function isMcpToolName(name: string): boolean {
  return /^mcp__[a-zA-Z0-9][a-zA-Z0-9_-]*__[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name);
}

function parseRequestedNames(params: Record<string, unknown>): string[] {
  const fromArray = Array.isArray(params.names)
    ? params.names.filter((n): n is string => typeof n === "string")
    : [];
  const raw = typeof params.name === "string" ? params.name : "";
  const fromString = raw
    .split(/[,，\s]+/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return [...new Set([...fromArray, ...fromString].map((n) => n.trim()).filter(Boolean))];
}

export const listMoreTools: AgentTool = {
  definition: {
    name: LIST_MORE_TOOLS_NAME,
    description:
      "列出本轮可临时启用的更多能力；传入 name 或 names 后即可在本会话调用（可一次启用多项，不改常用工具目录）。",
    category: "system",
    parameters: {
      name: {
        type: "string",
        description: "要启用的能力名称，逗号分隔多项亦可。省略则只返回目录。",
      },
      names: {
        type: "array",
        description: "要同时启用的能力名称列表。",
        items: { type: "string" },
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const allowScripts = ctx?.workspaceDir ? isAnalysisScriptsAllowed(ctx.workspaceDir) : false;
    const highSec = ctx?.workspaceDir ? isHighSecurityMode(ctx.workspaceDir) : false;
    const catalog = DISCLOSED_TOOL_HINTS.filter((row) => {
      if (CORE_SET.has(row.name)) {
        return false;
      }
      if (row.name === "run_analysis") {
        return allowScripts;
      }
      if (row.name === "run_compute") {
        return !highSec;
      }
      if (WEB_SEARCH_TOOL_NAMES.has(row.name)) {
        return ctx?.allowWebSearch === true;
      }
      return true;
    }).map((row) => ({
      name: row.name,
      hint: row.hint,
    }));
    const requested = parseRequestedNames(params);
    if (requested.length === 0) {
      return {
        ok: true,
        data: {
          tools: catalog,
          message:
            "需要某项能力时再传入 name 或 names，本会话即可调用。可一次启用多项。已配置的 MCP 不会每轮自动出现；把完整 mcp__server__tool 名称传入即可启用。",
        },
      };
    }
    const disclosed: string[] = [];
    const already: string[] = [];
    const unknown: string[] = [];
    let needAllowWebSearch = false;
    for (const raw of requested) {
      if (CORE_SET.has(raw) || raw === LIST_MORE_TOOLS_NAME || raw === UPDATE_PLAN_TOOL_NAME) {
        already.push(raw);
        continue;
      }
      if (isMcpToolName(raw)) {
        disclosed.push(raw);
        continue;
      }
      const hit = catalog.find((row) => row.name === raw);
      if (!hit) {
        if (WEB_SEARCH_TOOL_NAMES.has(raw) && ctx?.allowWebSearch !== true) {
          needAllowWebSearch = true;
        }
        unknown.push(raw);
        continue;
      }
      disclosed.push(hit.name);
    }
    if (disclosed.length === 0 && unknown.length > 0 && already.length === 0) {
      if (needAllowWebSearch) {
        return {
          ok: false,
          error:
            "对话栏「联网」未开启。list_more_tools 不能代替开关：请在输入框选项里把「联网」选成开启。",
          data: { tools: catalog, needAllowWebSearch: true },
        };
      }
      return {
        ok: false,
        error: "没有这项可披露能力",
        data: { tools: catalog },
      };
    }
    const hints = disclosed
      .map((name) => catalog.find((row) => row.name === name)?.hint)
      .filter((h): h is string => Boolean(h));
    return {
      ok: true,
      data: {
        ...(disclosed.length === 1 ? { disclosedName: disclosed[0] } : {}),
        ...(disclosed.length > 0 ? { disclosedNames: disclosed } : {}),
        alreadyAvailable: already.length > 0 ? already : undefined,
        unknown: unknown.length > 0 ? unknown : undefined,
        hint: hints[0],
        message:
          disclosed.length > 0
            ? `已启用：${disclosed.join("、")}`
            : already.length > 0
              ? "这些能力已在常用工具中，直接调用即可。"
              : "没有新的可披露能力。",
      },
    };
  },
};

/**
 * Retrieval protocol: coach statute/case trial before writing 条号.
 * Skip only the 5-minute opinion fast lane, or when search tools are not on
 * the table. Mail/Word may still search; do not freeze them off retrieval.
 */

import {
  isOpinionOnlyFastLane,
  RESEARCH_PROTOCOL_TOOLS,
  toolsAllowAny,
  type PromptProtocolGate,
} from "../agent/prompt-protocol-gate.js";

export const STATUTE_TRIAL_TOOLS = RESEARCH_PROTOCOL_TOOLS;

export function shouldInjectResearchProtocol(
  bound:
    | {
        id: string;
        pipeline: string;
      }
    | null
    | undefined,
  gate?: PromptProtocolGate,
): boolean {
  if (!bound) {
    return false;
  }
  if (isOpinionOnlyFastLane(gate?.instruction)) {
    return false;
  }
  if (!toolsAllowAny(gate?.availableToolNames, RESEARCH_PROTOCOL_TOOLS)) {
    return false;
  }
  return (
    bound.id === "research.memo" ||
    bound.id === "analysis.quick" ||
    bound.id === "contract.review" ||
    bound.id === "letter.draft" ||
    bound.id === "litigation.draft" ||
    bound.id === "mail.contract"
  );
}

export function statuteTrialHappenedThisTurn(
  counts?: Record<string, number> | null,
  autoTrial?: boolean,
): boolean {
  if (autoTrial === true) {
    return true;
  }
  if (!counts) {
    return false;
  }
  return STATUTE_TRIAL_TOOLS.some((name) => (counts[name] ?? 0) > 0);
}

/** Same shape as lint citation-validity; used to soft-stamp unverified 条号. */
const CITE_RE = /《([^》]{1,40})》\s*第\s*([0-9一二三四五六七八九十百]+)\s*条/;

export function looksLikeStatuteCitation(text: string): boolean {
  return CITE_RE.test(text);
}

export function shouldEnforceStatuteTrial(
  bound:
    | {
        id: string;
        pipeline: string;
      }
    | null
    | undefined,
): boolean {
  return shouldInjectResearchProtocol(bound);
}

export function formatResearchProtocolPromptBlock(): string {
  return [
    "## 检索协议",
    "写现行法条或类案之前：先按命题矩阵调用 `search_statute` 和 `search_case_law`（均为常用工具），每个争点试检 1–2 条再扩。",
    "无命中：栏目保留并标【待核实】，不得把模型记忆写成条号。废止法名单见 Skill · 规范现行有效。",
    "路径已钉选时不要翻案卷找附件；核法条仍可用检索。",
  ].join("\n");
}

export function formatUnretrievedStatuteBody(): string {
  return "本回合尚未试检 `search_statute` / `search_case_law`。不得把模型记忆写成现行法条。先检索；无工具或仅演示语料则标【待核实】并继续分析框架，不得写成已核对。";
}

/**
 * Solo「5 分钟合同审查」交办识别 + 本回合工具表。
 * Leaf (no fs) — safe for desktop renderer and agent runtime.
 */

import { isMailContractFastPathInstruction } from "./mail-contract-short-path-instruction.js";

/** Opinion path only — not redline / outbound / search. */
export const CONTRACT_FAST_LANE_TOOL_NAMES = [
  "analyze_document",
  "draft_document",
  "update_draft",
  "render_document",
] as const;

export const CONTRACT_FAST_LANE_DENIED_HINT =
  "本回合是合同审查快车道：请按 analyze_document → draft_document/update_draft → 验收后出意见书执行，不要再检索案卷。";

export const CONTRACT_FAST_LANE_PROMPT = [
  "## 合同审查 · 快车道",
  "- 材料与立场/重点已在交办里：勿再 `search_workspace` / `search_matter` / `read_project_file` / `list_templates` / `list_more_tools`。检索类工具本回合会直接拒绝。",
  "- 本回合只开放：`analyze_document`、`draft_document`/`update_draft`、`render_document`。",
  "- 工具序：`analyze_document`（通读已给合同）→ `draft_document`（`contract.review` 意见书）→ 必要时 `update_draft`。本地出稿用 `render_document`；不要 `prepare_outbound_mail` / `send_email`。",
  "- 按宏观交易结构、中观文本、微观条款写完意见；每个风险点给推荐措辞。缺事实仍交付已完成部分并在意见里写缺口。",
  "- 勿改走邮件红线短路径，除非律师另开邮件合同审阅。",
].join("\n");

/** Structured Solo / 填表交办. Campaign upgrade stays unlocked. */
export function isContractFastLaneInstruction(instruction: string): boolean {
  const t = instruction.trim();
  if (!t || isMailContractFastPathInstruction(t)) {
    return false;
  }
  if (/完整合同审查专案组/.test(t)) {
    return false;
  }
  if (/【交办】5 分钟合同审查/.test(t)) {
    return true;
  }
  if (/【办件】\s*能力\s*[：:]\s*contract\.review\b/i.test(t)) {
    return true;
  }
  return (
    /【交办】/.test(t) &&
    /交付物类型：合同审查意见/.test(t) &&
    (/己方立场/.test(t) || /审查重点/.test(t))
  );
}

export function contractFastLaneAllowNames(instruction: string): string[] | undefined {
  return isContractFastLaneInstruction(instruction)
    ? [...CONTRACT_FAST_LANE_TOOL_NAMES]
    : undefined;
}

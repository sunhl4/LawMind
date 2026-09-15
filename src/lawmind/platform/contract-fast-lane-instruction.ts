/**
 * Solo「5 分钟合同审查」交办识别 + 提示词教练。
 * Does **not** freeze the tool table — the model may still search or redline
 * if that helps finish the job. Leaf (no fs).
 */

import { isMailContractFastPathInstruction } from "./mail-contract-short-path-instruction.js";

/** Preferred tools for a 5-minute opinion — coaching only, not an allowlist. */
export const CONTRACT_FAST_LANE_TOOL_NAMES = [
  "analyze_document",
  "draft_document",
  "update_draft",
  "render_document",
] as const;

const CONTRACT_FAST_LANE_CORE = [
  "## 合同审查 · 快车道",
  "- 这是快速意见：材料与立场/重点已在交办里。先通读已给合同，按宏观交易结构、中观文本、微观条款写完意见；每个风险点给推荐措辞。",
  "- 缺事实仍交付已完成部分并在意见里写缺口。不要为了找材料反复翻全所案卷。",
  "- 工具表不收窄。写条号需要核对时可以用 `search_statute`；律师若还要修订稿，可以用改稿工具。不要改走邮件外发短路径，除非律师另开邮件合同审阅。",
] as const;

/** No Word pin: opinion Word. Pinned Word uses {@link formatContractFastLanePrompt}. */
export const CONTRACT_FAST_LANE_PROMPT = [
  ...CONTRACT_FAST_LANE_CORE,
  "- 本地意见书优先 `draft_document` → `render_document`。",
].join("\n");

/** 5-minute craft. Word pin → paired opinion + tracked redline; do not fight 成套交件. */
export function formatContractFastLanePrompt(opts?: { wordPinned?: boolean }): string {
  if (opts?.wordPinned) {
    return [
      ...CONTRACT_FAST_LANE_CORE,
      "- 本回合钉选了 Word：默认交审查意见以及一份审阅修订稿（`apply_surgical_edits` → `render_tracked_draft`）。律师只要意见书时按指定。",
    ].join("\n");
  }
  return CONTRACT_FAST_LANE_PROMPT;
}

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
  return (
    /【交办】/.test(t) &&
    /交付物类型：合同审查意见/.test(t) &&
    (/己方立场/.test(t) || /审查重点/.test(t))
  );
}

/** @deprecated Prompt coaching only. Never freeze the tool table. */
export function contractFastLaneAllowNames(_instruction: string): string[] | undefined {
  return undefined;
}

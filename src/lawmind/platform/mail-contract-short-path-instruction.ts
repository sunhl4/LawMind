/**
 * Pure short-path instruction text for mail-contract redline.
 * Leaf module (no fs) — safe for desktop renderer and agent runtime.
 */

import { SURGICAL_MAX_FIND_WITH_TERMINATOR } from "../drafts/surgical-span-gate.js";
import { normalizeOutboundRecipient } from "./lawyer-outbound-decision.js";

/** Preferred mail-contract path (coaching). Not the advertised tool table. */
export const MAIL_CONTRACT_FAST_PATH_TOOL_NAMES = [
  "analyze_document",
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "render_tracked_draft",
  "prepare_outbound_mail",
] as const;

/** Hard deny: mis-send and template-rebuild of the source attachment. */
export const MAIL_CONTRACT_DENY_TOOL_NAMES = ["send_email", "render_document"] as const;

export const MAIL_CONTRACT_FAST_PATH_DENIED_HINT =
  "本回合是邮件合同短路径：附件路径已在指令里，不要翻案卷找同一份附件。核法条可以用检索。不要 send_email，不要用 render_document 重建附件。按任务选用工具，不要为走固定次序丢掉判断。";

/** @deprecated Playbook no longer freezes an allow-list. */
export function mailContractFastPathAllowNames(_instruction: string): string[] | undefined {
  return undefined;
}

export function mailContractFastPathDenyNames(instruction: string): string[] | undefined {
  return isMailContractFastPathInstruction(instruction)
    ? [...MAIL_CONTRACT_DENY_TOOL_NAMES]
    : undefined;
}

/** Detect automation / workflow instruction for mail-contract tracked or opinion path. */
export function isMailContractFastPathInstruction(instruction: string): boolean {
  const t = instruction.trim();
  if (!t) {
    return false;
  }
  return (
    /【邮件合同审阅/.test(t) ||
    /mail-contract-redline/i.test(t) ||
    (/邮件合同/.test(t) && /render_tracked_draft|prepare_outbound_mail/.test(t))
  );
}

export function buildMailContractShortPathInstruction(params: {
  matterId: string;
  preferredBaselinePath: string;
  replyToEmail?: string;
  mailBlocks?: string;
}): string {
  const mailBlocks =
    params.mailBlocks?.trim() ||
    `- 基线附件：\`${params.preferredBaselinePath}\`（路径已给出，勿再检索）`;
  return [
    "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
    `matterId=\`${params.matterId.trim()}\``,
    `默认 contract_edit_baseline_path=\`${params.preferredBaselinePath}\``,
    params.replyToEmail ? `建议回复收件人：${params.replyToEmail}` : "",
    "",
    "## 相关邮件与附件（路径已给出）",
    mailBlocks,
    "",
    "## 执行约束",
    "- 附件路径已给出：不要再翻案卷找同一份附件。核法条可用 `search_statute` / `search_case_law`。勿再问审查重点/己方立场。",
    "- 通读附件与批注/对方修订；多份附件可以继续读，不要反复读同一文件。",
    `- **最小修改（跨度硬门禁·条数不限）**：落改用 \`apply_surgical_edits\`（附 \`craft_check\`）。能改几个字就只改几个字；段内只改有问题的句子；含句读 find≤${SURGICAL_MAX_FIND_WITH_TERMINATOR} 字。正例：\`甲方所在地人民法院\`→\`上海仲裁委员会\`；句末加词：\`实际损失。\`→\`实际损失，但累计…。\`。`,
    "- 整句/整段删写会被硬门禁跳过；勿整节重写进 `update_draft.sections`。其余争点 deferred。",
    "- `redlinePending=0` 不得 `render_tracked_draft`（空修订门禁）。不要 `send_email`。不要用 `render_document` 重建附件。",
    "",
    "## 推荐路径（按任务选用，不要为走工具序丢掉判断）",
    "- 改稿：`analyze_document`、`draft_document`/`update_draft`（`contract_edit_baseline_path` + `seed_sections_from_baseline=true`）、`apply_surgical_edits`、`render_tracked_draft` 写入源文件同目录（原名_日期_01.docx，不打开 Word）。",
    "- 交接：`prepare_outbound_mail`（to=对方邮箱，附件=修订稿路径）。可以在对话里说明改了什么。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** `建议回复收件人：a@b.com` from the short-path instruction, if present. */
export function extractSuggestedReplyTo(instruction: string): string | undefined {
  const line = instruction.match(/建议回复收件人：\s*(.+)/);
  if (!line?.[1]) {
    return undefined;
  }
  const first = line[1].trim().split(/[\s,;，；]/)[0] ?? "";
  const to = normalizeOutboundRecipient(first);
  return to || undefined;
}

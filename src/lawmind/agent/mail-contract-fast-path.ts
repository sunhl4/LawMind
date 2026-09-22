/**
 * Mail-contract redline: operational short path + craft skill (span-local edits).
 */

import { CONTRACT_REDLINE_CRAFT_SKILL } from "../drafts/contract-redline-craft.js";

export {
  extractSuggestedReplyTo,
  isMailContractFastPathInstruction,
  MAIL_CONTRACT_DENY_TOOL_NAMES,
  MAIL_CONTRACT_FAST_PATH_DENIED_HINT,
  MAIL_CONTRACT_FAST_PATH_TOOL_NAMES,
  mailContractFastPathAllowNames,
  mailContractFastPathDenyNames,
} from "../platform/mail-contract-short-path-instruction.js";

/**
 * Injected into the system prompt for mail-contract jobs.
 * Ops constraints stay thin; edit quality comes from craft skill.
 * Hard deny is only send_email / render_document — not a frozen tool table.
 */
export const MAIL_CONTRACT_FAST_PATH_PROMPT = [
  "## 邮件合同审阅 · 短路径",
  "- 指令已含附件路径与 matterId：不要再翻案卷找附件。核法条可以用 `search_statute` / `search_case_law`。",
  "- 推荐路径：`analyze_document`、`draft_document`/`update_draft`、`apply_surgical_edits`、`render_tracked_draft`、`prepare_outbound_mail`。按任务选用，不要为走工具序丢掉判断。",
  "- 不要 `send_email`。不要用 `render_document` 重建附件。可以在对话里说明改了什么。",
  "- 勿再追问「审查重点 / 己方立场」：从当事人与邮件推断（常见：我方=乙方/受托方；对方批注=国浩/甲方侧）。",
  "- 落改：通读附件后 seed 基线 → `apply_surgical_edits` → `render_tracked_draft` → `prepare_outbound_mail`。多份附件可以继续读；不要反复读同一文件。",
  "- **最小修改（硬约束·条数不限）**：只标真正变动的字，没动的字必须留在修订轨之外；一句话里改几个字就只改那几个字（引擎会把每处重算成最短改动）。",
  "- `redlinePending≥1` 是空修订门禁；跨度纪律见下方 Craft Skill。禁止空修订假完成。",
  "",
  CONTRACT_REDLINE_CRAFT_SKILL,
].join("\n");

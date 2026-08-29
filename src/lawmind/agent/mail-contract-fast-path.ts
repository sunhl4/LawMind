/**
 * Mail-contract redline: operational short path + craft skill (span-local edits).
 */

import { CONTRACT_REDLINE_CRAFT_SKILL } from "../drafts/contract-redline-craft.js";

export {
  extractSuggestedReplyTo,
  isMailContractFastPathInstruction,
  MAIL_CONTRACT_FAST_PATH_DENIED_HINT,
  MAIL_CONTRACT_FAST_PATH_TOOL_NAMES,
  mailContractFastPathAllowNames,
} from "../platform/mail-contract-short-path-instruction.js";

/**
 * Injected into the system prompt for mail-contract jobs.
 * Ops constraints stay thin; edit quality comes from craft skill + hard tool lock.
 */
export const MAIL_CONTRACT_FAST_PATH_PROMPT = [
  "## 邮件合同审阅 · 短路径",
  "- 指令已含附件路径与 matterId：勿再 `search_workspace` / `search_matter` / `read_project_file` / `list_templates` / `get_matter_summary` / `list_matters` / `list_mail_*` / `list_drafts` / `list_tasks`。检索类工具本回合会直接拒绝。",
  "- 本回合只开放：`analyze_document`、`draft_document`/`update_draft`、`apply_surgical_edits`、`render_tracked_draft`、`prepare_outbound_mail`。",
  "- 勿再追问「审查重点 / 己方立场」：从当事人与邮件推断（常见：我方=乙方/受托方；对方批注=国浩/甲方侧）。",
  "- 工具序：`analyze_document`(1 次，通读) → `draft_document`/`update_draft`（`contract_edit_baseline_path` + `seed_sections_from_baseline=true`）→ `apply_surgical_edits`（最短锚定 + `craft_check`）→ `render_tracked_draft`（源文件同目录，原名_日期_01.docx）→ `prepare_outbound_mail`。",
  "- **最小修改（硬门禁·条数不限）**：能改几个字就只改几个字；段有问题只改有问题的句子；整句/整段删写会被 `apply_surgical_edits` 拒绝/跳过。",
  "- `redlinePending≥1` 是空修订门禁；跨度纪律见下方 Craft Skill。禁止空修订假完成。",
  "",
  CONTRACT_REDLINE_CRAFT_SKILL,
].join("\n");

/**
 * File-page / dialog「改这份 Word」— copy original + tracked revisions.
 * Leaf (no fs). Mail-contract still owns outbound; this path never advertises mail tools.
 */

import type { ComposeContextPin } from "./compose-context-pin.js";
import { isContractFastLaneInstruction } from "./contract-fast-lane-instruction.js";
import { isMailContractFastPathInstruction } from "./mail-contract-short-path-instruction.js";

/** Existing-Word edit — not opinion rebuild, not outbound mail. */
export const WORD_REVISION_TOOL_NAMES = [
  "analyze_document",
  "read_project_file",
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "render_tracked_draft",
] as const;

export const WORD_REVISION_DENIED_HINT =
  "本回合是原 Word 改稿：唯一交付物是源文件同目录的带审阅痕迹 Word。请按通读 → seed 基线 → apply_surgical_edits → render_tracked_draft。不要意见书，不要 render_document，不要准备外发邮件。";

const FILE_PAGE_RE = /【用户(?:将下列路径标为|在 LawMind 文件页)/;
const WORD_FILE_RE = /\.docx?\b/i;
const EDIT_INTENT_RE =
  /修改合同|改合同|改这份|合同改稿|改稿本合同|修改这份|审阅痕迹|红线稿|出修订|修订稿|审阅稿|甲方修改|乙方修改|立场甲方|立场乙方|代表甲方|代表乙方|按甲方|按乙方|在原(?:合同|文件|Word)|导出.+(?:Word|word|docx|审阅)|打开结果|出一份修改|(?:请|帮我).{0,8}(?:改|修)(?:一下|这份)/;
const FOLLOW_UP_EXPORT_RE = /导出|出稿|打开结果|改稿|修订|立场/;
/** Chip-written marker lines must not by themselves read as edit intent on later turns. */
const MARKER_LINE_RE = /^[ \t]*(?:改稿类型|己方立场)：.*$/gm;

export function instructionHasWordFile(instruction: string): boolean {
  return (
    WORD_FILE_RE.test(instruction) ||
    /contract_edit_baseline_path\s*=/.test(instruction) ||
    /\[(?:项目|工作区)[^\]]*\]\s*`[^`]+\.docx?`/.test(instruction)
  );
}

export function pinsHaveWordFile(pins?: ComposeContextPin[]): boolean {
  return (pins ?? []).some((pin) => {
    if (!("relPath" in pin) || typeof pin.relPath !== "string") {
      return false;
    }
    if ("kind" in pin && pin.kind === "directory") {
      return false;
    }
    return WORD_FILE_RE.test(pin.relPath);
  });
}

export function instructionLooksLikeWordEdit(instruction: string): boolean {
  return EDIT_INTENT_RE.test(instruction) || /【Word 改稿|word-revision/i.test(instruction);
}

export type WordRevisionTurnInput = {
  instruction: string;
  pins?: ComposeContextPin[];
  historyText?: string;
};

/** Detect file-page, dialog pin, or follow-up 导出 — never the mail short path. */
export function isWordRevisionTurn(input: WordRevisionTurnInput | string): boolean {
  const params = typeof input === "string" ? { instruction: input } : input;
  const t = params.instruction.trim();
  if (!t || isMailContractFastPathInstruction(t)) {
    return false;
  }
  if (isContractFastLaneInstruction(t) && !instructionLooksLikeWordEdit(t)) {
    return false;
  }
  if (/【Word 改稿|word-revision/i.test(t)) {
    return true;
  }
  const body = t.replace(MARKER_LINE_RE, "");
  const hasWord =
    instructionHasWordFile(t) ||
    pinsHaveWordFile(params.pins) ||
    instructionHasWordFile(params.historyText ?? "");
  const hasEdit = instructionLooksLikeWordEdit(body) || FOLLOW_UP_EXPORT_RE.test(body);
  if (FILE_PAGE_RE.test(t) && hasWord && (hasEdit || /修改|改稿|修订|导出|出稿/.test(body))) {
    return true;
  }
  return hasWord && hasEdit;
}

/** @deprecated use isWordRevisionTurn — kept for call sites that only have instruction text. */
export function isWordRevisionInstruction(instruction: string): boolean {
  return isWordRevisionTurn(instruction);
}

export function wordRevisionAllowNames(
  instruction: string,
  pins?: ComposeContextPin[],
): string[] | undefined {
  return isWordRevisionTurn({ instruction, pins }) ? [...WORD_REVISION_TOOL_NAMES] : undefined;
}

export const WORD_REVISION_PROMPT = [
  "## Word 改稿 · 原文件审阅痕迹",
  "- 这是**已有 Word 的改稿**。本回合**唯一交付物**是源文件同目录的带审阅痕迹 `.docx`。",
  "- 不要意见书，不要模板重建稿，不要写到 artifacts/，不要用对话长文代替文件。",
  "- 本回合只开放：`analyze_document` / `read_project_file`、`draft_document`/`update_draft`、`apply_surgical_edits`、`render_tracked_draft`。",
  "- 禁止 `render_document`。禁止 `prepare_outbound_mail` / `send_email`。",
  "- 通读钉选 Word **成功一次即可**。不要再 `analyze_document`，也不要读 `playbooks/` 或条款库。",
  "- 若本回合已注入「改稿要点」：按看/改/停处理。检查单不是必须全改；停项与未确认数字写入 deferred。类型仅为疑似时，正文不对题则忽略该清单。",
  "- 工具序：通读钉选 Word → `draft_document`/`update_draft`（`contract_edit_baseline_path` = 源文件相对路径，`seed_sections_from_baseline=true`，deliverable 必须是合同正文不是审查意见）→ `apply_surgical_edits` → `render_tracked_draft`。",
  "- 导出规则（引擎执行）：**拷贝原文件**，在**源文件同一目录**写入 `原名_YYYYMMDD_01.docx`。不改原件；保留原格式与原有修订，只叠加新修订。",
  "- `redlinePending=0` 不得导出。",
].join("\n");

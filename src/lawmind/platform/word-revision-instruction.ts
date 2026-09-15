/**
 * File-page / dialog「改这份 Word」— copy original + tracked revisions.
 * Leaf (no fs). Mail-contract still owns outbound; this path denies mail send/prepare.
 */

import { extractDeliveryIntent, isOpinionMemoDelivery } from "../intent/delivery-intent.js";
import type { ComposeContextPin } from "./compose-context-pin.js";
import { isContractFastLaneInstruction } from "./contract-fast-lane-instruction.js";
import { isMailContractFastPathInstruction } from "./mail-contract-short-path-instruction.js";

/** Preferred Word-revision path (coaching). Not the advertised tool table. */
export const WORD_REVISION_TOOL_NAMES = [
  "analyze_document",
  "read_project_file",
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "render_tracked_draft",
] as const;

/** Hard deny: template-rebuild of the source Word, outbound mail, and send. */
export const WORD_REVISION_DENY_TOOL_NAMES = [
  "send_email",
  "render_document",
  "prepare_outbound_mail",
] as const;

export const WORD_REVISION_DENIED_HINT =
  "本回合是原 Word 改稿：请拷贝原件落审阅痕迹。可以在对话里说明改了什么。不要用 render_document 重建原件，不要准备外发邮件。";

const FILE_PAGE_RE = /【用户(?:将下列路径标为|在 LawMind 文件页)/;
const WORD_FILE_RE = /\.docx?\b/i;
const EDIT_INTENT_RE =
  /修改合同|改合同|改这份|合同改稿|改稿本合同|修改这份|审阅痕迹|红线稿|出修订|修订稿|审阅稿|在原(?:合同|文件|Word)|导出.+(?:修订|审阅痕迹|红线|带修订)|打开结果|出一份修改|(?:请|帮我).{0,8}(?:改|修)(?:一下|这份)/;
/** Follow-up that is clearly a tracked-file action — not 立场 / bare 导出. */
const FOLLOW_UP_EXPORT_RE = /打开结果|合同改稿|改稿本合同|(?:带)?审阅痕迹|红线稿|出修订/;
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
  let candidate = false;
  if (FILE_PAGE_RE.test(t) && hasWord && (hasEdit || /修改|改稿|修订/.test(body))) {
    candidate = true;
  } else {
    candidate = hasWord && hasEdit;
  }
  if (!candidate) {
    return false;
  }
  // Lawyer-named opinion sidecar beats Word-lock heuristics ("出一份修改建议").
  if (isOpinionMemoDelivery(extractDeliveryIntent(t))) {
    return false;
  }
  return true;
}

/** @deprecated use isWordRevisionTurn — kept for call sites that only have instruction text. */
export function isWordRevisionInstruction(instruction: string): boolean {
  return isWordRevisionTurn(instruction);
}

/** @deprecated Playbook no longer freezes an allow-list. */
export function wordRevisionAllowNames(
  _instruction: string,
  _pins?: ComposeContextPin[],
): string[] | undefined {
  return undefined;
}

export function wordRevisionDenyNames(
  instruction: string,
  pins?: ComposeContextPin[],
): string[] | undefined {
  return isWordRevisionTurn({ instruction, pins }) ? [...WORD_REVISION_DENY_TOOL_NAMES] : undefined;
}

export const WORD_REVISION_PROMPT = [
  "## Word 改稿 · 原文件审阅痕迹",
  "- 这是**已有 Word 的改稿**。请把带审阅痕迹的 `.docx` 写到源文件同目录；可以在对话里说明改了什么。",
  "- 不要用 `render_document` 模板重建原件，不要写到 artifacts/ 顶替原件修订。",
  "- 推荐路径：`analyze_document` / `read_project_file` → `draft_document`/`update_draft`（seed 基线）→ `apply_surgical_edits` → `render_tracked_draft`。核法条可用 `search_statute`。按任务选用，不要为走工具序丢掉判断。",
  "- 禁止 `render_document` 重建原件。禁止 `prepare_outbound_mail` / `send_email`。",
  "- 优先通读钉选 Word；多份材料可以继续读。不要反复读同一文件，也不要读 `playbooks/` 或条款库。",
  "- 若本回合已注入「改稿要点」：按看/改/停处理。检查单不是必须全改；停项与未确认数字写入 deferred。类型仅为疑似时，正文不对题则忽略该清单。",
  "- 落改：`draft_document`/`update_draft`（`contract_edit_baseline_path` = 源文件相对路径，`seed_sections_from_baseline=true`，deliverable 必须是原文件正文不是审查意见或重建稿）→ `apply_surgical_edits` → `render_tracked_draft`。",
  "- 导出规则（引擎执行）：**拷贝原文件**，在**源文件同一目录**写入 `原名_YYYYMMDD_01.docx`。不改原件；保留原格式与原有修订，只叠加新修订。",
  "- `redlinePending=0` 不得导出。",
].join("\n");

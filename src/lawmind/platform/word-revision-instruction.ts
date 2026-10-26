/**
 * File-page / dialog「改这份 Word」— copy original + tracked revisions.
 * Leaf (no fs). Mail-contract still owns outbound; this path denies mail send/prepare.
 */

import { extractDeliveryIntent, isOpinionMemoDelivery } from "../intent/delivery-intent.js";
import type { ComposeContextPin } from "./compose-context-pin.js";
import { isMailContractFastPathInstruction } from "./mail-contract-short-path-instruction.js";

/** Preferred Word-revision path (coaching). Not the advertised tool table. */
export const WORD_REVISION_TOOL_NAMES = [
  "analyze_document",
  "read_project_file",
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "render_tracked_draft",
  // 格式体检与格式修订是同一条改稿链上的收尾动作：先看清单，再决定是否统一。
  "check_document_format",
  "fix_document_format",
] as const;

/** Hard deny: template-rebuild of the source Word, outbound mail, and send. */
export const WORD_REVISION_DENY_TOOL_NAMES = [
  "send_email",
  "render_document",
  "prepare_outbound_mail",
] as const;

/**
 * 「另起一份」不是改原稿。律师要新版本/新协议时，模型必须能重建文档；
 * 把 render_document 一起禁掉会把这类合法请求变成无解。
 *
 * 判据刻意收窄：必须**明确**说另起一份/重新起草，或明确说不要动原件。
 * 「另出一份修订稿」「出个新版本」这类仍按改原稿处理——那要的是原件副本加痕迹，
 * 放开重建会让模型拿模板重排，丢掉原格式和已有修订。
 */
const NEW_DOCUMENT_ASK_RE =
  /不要(?:改|动|碰)原(?:件|稿|文件)|重新起草|从(?:头|零)起草|另(?:起|出|做|写|拟)(?:一份|份)?(?:新的?)?(?:协议|合同|文书|文件|函|意见书|备忘录|稿)/;

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

/** True when a pinned/named path is a Word file (the only thing 改稿 can edit). */
export function isWordFileRelPath(relPath: string): boolean {
  const trimmed = relPath.trim();
  return trimmed.length > 0 && WORD_FILE_RE.test(trimmed);
}

/**
 * Yesterday's `.docx` in the transcript does not make this turn a Word edit
 * when the lawyer pinned or named a non-Word file.
 */
function historySuppliesWordFile(params: WordRevisionTurnInput): boolean {
  if (!instructionHasWordFile(params.historyText ?? "")) {
    return false;
  }
  const filePins = (params.pins ?? []).filter((pin) => {
    if (!("relPath" in pin) || typeof pin.relPath !== "string") {
      return false;
    }
    if ("kind" in pin && pin.kind === "directory") {
      return false;
    }
    return pin.relPath.trim().length > 0;
  });
  if (
    filePins.length > 0 &&
    !filePins.some((pin) => "relPath" in pin && WORD_FILE_RE.test(pin.relPath))
  ) {
    return false;
  }
  if (/\.pdf\b/i.test(params.instruction) && !WORD_FILE_RE.test(params.instruction)) {
    return false;
  }
  return true;
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
  if (/【Word 改稿|word-revision/i.test(t)) {
    return true;
  }
  const body = t.replace(MARKER_LINE_RE, "");
  const hasWord =
    instructionHasWordFile(t) || pinsHaveWordFile(params.pins) || historySuppliesWordFile(params);
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

export function wordRevisionDenyNames(
  instruction: string,
  pins?: ComposeContextPin[],
): string[] | undefined {
  if (!isWordRevisionTurn({ instruction, pins })) {
    return undefined;
  }
  if (NEW_DOCUMENT_ASK_RE.test(instruction)) {
    // 明确要另起一份：只继续禁外发，放开 render_document。
    return WORD_REVISION_DENY_TOOL_NAMES.filter((name) => name !== "render_document");
  }
  return [...WORD_REVISION_DENY_TOOL_NAMES];
}

export const WORD_REVISION_PROMPT = [
  "## Word 改稿 · 原文件审阅痕迹",
  "- 这是**已有 Word 的改稿**。请把带审阅痕迹的 `.docx` 写到源文件同目录；可以在对话里说明改了什么。",
  "- 不要用 `render_document` 模板重建原件，不要写到 artifacts/ 顶替原件修订。",
  "- 推荐路径：`analyze_document` / `read_project_file` → `draft_document`/`update_draft`（seed 基线）→ `apply_surgical_edits` → `render_tracked_draft`。核法条可用 `search_statute`。按任务选用，不要为走工具序丢掉判断。",
  "- **同一原件只拷一次**：首次 `render_tracked_draft` 在源文件同目录写出 `原名_日期_01.docx`（不改原件）。追问改稿必须复用该 taskId / 在办审阅副本覆盖写回，禁止再 `draft_document` 新开任务、禁止再生成 `_02`。律师若重命名了副本，钉选该副本后仍写回同一文件。",
  "- 禁止 `render_document` 重建原件。禁止 `prepare_outbound_mail` / `send_email`。",
  "- 优先通读钉选 Word；多份材料可以继续读。不要反复读同一文件，也不要读 `playbooks/` 或条款库。",
  "- 多份独立合同，或长文里互不依赖、各自都要通读的争点：第一轮并行 `draft_worker`（role=review，section 各不相同）。每支只交原句、改后句、待确认。一两处短改不要派。",
  "- 父对话用交回的原句 `apply_surgical_edits`，再按份 `render_tracked_draft`。子代理读过的全文不要再整份读进来；原句对不上时只重读那一处。定位不到的写入 craft_check.deferred，不因此停整单。配额用尽时用 resume_id 续那一支，不要把配额用完当成没做完。",
  "- 若本回合已注入「改稿要点」：按看/改/停处理。检查单不是必须全改；停项与未确认数字写入 deferred。类型仅为疑似时，正文不对题则忽略该清单。检查单未覆盖不拦出稿。",
  "- 落改：首次 `draft_document`/`update_draft`（`contract_edit_baseline_path` = **原件**相对路径，`seed_sections_from_baseline=true`）→ `apply_surgical_edits` → `render_tracked_draft`。之后追问只 `apply_surgical_edits` + `render_tracked_draft`（同一 taskId）；`draft_document` 若撞上在办审阅副本会直接交回原 taskId，不再另拷。",
  "- 导出规则（引擎执行）：首次**拷贝原文件**到同目录 `原名_YYYYMMDD_01.docx`；之后覆盖该审阅副本。不改原件；保留原格式与原有修订，只叠加新修订。",
  "- 原有修订是证据：对方/前手留下的 `w:ins`/`w:del` 一条都不能丢。导出会自动对账，丢一条就拒交，不要绕过。",
  "- 只要求统一格式（字体/字号/行距/缩进）、不动措辞时：用 `check_document_format` 看清单，再 `fix_document_format` 出「格式修订」副本；不要为凑修订去改内容。",
  "- `redlinePending=0` 不得用 `render_tracked_draft` 导出；格式副本走 `fix_document_format`。",
].join("\n");

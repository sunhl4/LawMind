/**
 * Clarification field helpers — shared by engine resume + desktop forms.
 */

import { outlineAnswerDecision } from "../research/outline-hitl.js";
import type { ClarificationInputType, ClarificationQuestion } from "../types.js";

const INPUT_TYPES = new Set<ClarificationInputType>([
  "text",
  "textarea",
  "enum",
  "bool",
  "date",
  "file",
]);

/** Desk 附加材料（多行 【材料】编码），不对应某一提问 key。 */
export const CLARIFY_ATTACHMENTS_KEY = "__attachments__";
/** Desk 带入的对话引用（多行 【对话】编码）。 */
export const CLARIFY_SESSIONS_KEY = "__sessions__";

const RESERVED_ANSWER_KEYS = new Set([CLARIFY_ATTACHMENTS_KEY, CLARIFY_SESSIONS_KEY]);

/** Normalize optional inputType; infer file/date/bool from key/question heuristics when missing. */
export function normalizeClarificationInputType(q: ClarificationQuestion): ClarificationInputType {
  if (q.inputType && INPUT_TYPES.has(q.inputType)) {
    return q.inputType;
  }
  if (q.options && q.options.length > 0) {
    return "enum";
  }
  const blob = `${q.key} ${q.question}`.toLowerCase();
  if (/(扫描件|附件|上传|文件|pdf|docx|材料|证据照片|合同原件)/i.test(blob)) {
    return "file";
  }
  if (/(日期|年月日|起止|deadline|签订日|到期)/i.test(blob)) {
    return "date";
  }
  const isYesNoQuestion = /^(是否|有没有|能否)/.test(q.question.trim());
  const isBoolKey = /^(is_|has_|是否)/i.test(q.key);
  if (isYesNoQuestion || isBoolKey) {
    return "bool";
  }
  if ((q.reason?.length ?? 0) > 40 || q.question.length > 36) {
    return "textarea";
  }
  return "text";
}

export function clarificationQuestionRequired(q: ClarificationQuestion): boolean {
  return q.required !== false;
}

/**
 * P2：对话内可嵌「同表缩略」——至多 2 项，且无文件/大段文本。
 */
export function isClarificationShortConfirm(questions: ClarificationQuestion[]): boolean {
  if (questions.length === 0 || questions.length > 2) {
    return false;
  }
  return questions.every((q) => {
    const t = normalizeClarificationInputType(q);
    return t === "text" || t === "bool" || t === "enum" || t === "date";
  });
}

/**
 * Whether chat should inline the clarification form (vs 「去在办」hint).
 * Outline HITL always inlines — lawyers must confirm with one click in the thread.
 */
export function shouldInlineClarificationInChat(questions: ClarificationQuestion[]): boolean {
  if (isClarificationShortConfirm(questions)) {
    return true;
  }
  if (
    questions.length > 0 &&
    questions.length <= 3 &&
    questions.some((q) => q.key === "research_outline_confirm")
  ) {
    return true;
  }
  return false;
}

export type ClarificationFilePin = {
  root: "workspace" | "project";
  relPath: string;
  kind: "file" | "directory";
};

export type ClarificationSessionRef = {
  sessionId: string;
  title: string;
};

const FILE_ANSWER_RE = /^【材料】(workspace|project):(file|directory):(.+)$/;
const SESSION_ANSWER_RE = /^【对话】([^|]+)\|([\s\S]*)$/;

export function encodeClarificationFileAnswer(pin: ClarificationFilePin): string {
  return `【材料】${pin.root}:${pin.kind}:${pin.relPath}`;
}

export function parseClarificationFileAnswer(raw: string): ClarificationFilePin | null {
  const m = raw.trim().match(FILE_ANSWER_RE);
  if (!m) {
    return null;
  }
  return {
    root: m[1] as "workspace" | "project",
    kind: m[2] as "file" | "directory",
    relPath: m[3],
  };
}

export function encodeClarificationSessionRef(ref: ClarificationSessionRef): string {
  const title = ref.title.replace(/\n/g, " ").trim() || ref.sessionId;
  return `【对话】${ref.sessionId}|${title}`;
}

export function parseClarificationSessionRef(raw: string): ClarificationSessionRef | null {
  const m = raw.trim().match(SESSION_ANSWER_RE);
  if (!m) {
    return null;
  }
  return {
    sessionId: m[1].trim(),
    title: (m[2] ?? "").trim() || m[1].trim(),
  };
}

function eachAnswerLine(answers: Record<string, string>, visit: (line: string) => void): void {
  for (const v of Object.values(answers)) {
    if (!v?.trim()) {
      continue;
    }
    for (const line of v.split("\n")) {
      const t = line.trim();
      if (t) {
        visit(t);
      }
    }
  }
}

export function collectClarificationFilePins(
  answers: Record<string, string>,
): ClarificationFilePin[] {
  const out: ClarificationFilePin[] = [];
  const seen = new Set<string>();
  eachAnswerLine(answers, (line) => {
    const pin = parseClarificationFileAnswer(line);
    if (!pin) {
      return;
    }
    const id = `${pin.root}|${pin.kind}|${pin.relPath}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    out.push(pin);
  });
  return out;
}

export function collectClarificationSessionRefs(
  answers: Record<string, string>,
): ClarificationSessionRef[] {
  const out: ClarificationSessionRef[] = [];
  const seen = new Set<string>();
  eachAnswerLine(answers, (line) => {
    const ref = parseClarificationSessionRef(line);
    if (!ref || seen.has(ref.sessionId)) {
      return;
    }
    seen.add(ref.sessionId);
    out.push(ref);
  });
  return out;
}

export function appendEncodedLine(existing: string | undefined, encoded: string): string {
  const line = encoded.trim();
  if (!line) {
    return (existing ?? "").trim();
  }
  const prev = (existing ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (prev.includes(line)) {
    return prev.join("\n");
  }
  return [...prev, line].join("\n");
}

export function removeEncodedLine(existing: string | undefined, encoded: string): string {
  const target = encoded.trim();
  return (existing ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && s !== target)
    .join("\n");
}

export function formatClarificationFilePinsPrefix(pins: ClarificationFilePin[]): string {
  if (pins.length === 0) {
    return "";
  }
  const lines = pins.map((it) => {
    const scope = it.root === "workspace" ? "工作区" : "项目";
    const p = it.relPath || "（根）";
    if (it.root === "workspace") {
      const hint =
        it.kind === "directory"
          ? "请先在目录中定位文件，再用 analyze_document 读工作区相对路径。"
          : "请用 analyze_document 读取以下工作区相对路径。";
      return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
    }
    const hint =
      it.kind === "directory"
        ? "对项目内文件用 read_project_file；目录下请先列举再选读。"
        : "请用 read_project_file 读取。";
    return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
  });
  return `【律师在补充信息时挂接的材料】\n${lines.join("\n")}\n\n`;
}

export function formatClarificationSessionRefsPrefix(refs: ClarificationSessionRef[]): string {
  if (refs.length === 0) {
    return "";
  }
  const lines = refs.map(
    (r) => `- 对话「${r.title}」（session \`${r.sessionId}\`）— 请结合该对话上下文继续办理。`,
  );
  return `【律师在补充信息时带入的对话】\n${lines.join("\n")}\n\n`;
}

export function displayClarificationAnswer(q: ClarificationQuestion, raw: string): string {
  const t = normalizeClarificationInputType(q);
  const v = raw.trim();
  if (!v) {
    return "";
  }
  if (t === "file") {
    const pin = parseClarificationFileAnswer(v);
    if (pin) {
      const scope = pin.root === "workspace" ? "工作区" : "项目";
      return `${scope} ${pin.kind === "directory" ? "目录" : "文件"}：${pin.relPath}`;
    }
  }
  if (t === "bool") {
    if (v === "yes" || v === "true" || v === "是") {
      return "是";
    }
    if (v === "no" || v === "false" || v === "否") {
      return "否";
    }
  }
  return v;
}

export function buildClarificationAnswerMap(
  questions: ClarificationQuestion[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const v = values[q.key]?.trim();
    if (v) {
      out[q.key] = v;
    }
  }
  for (const key of RESERVED_ANSWER_KEYS) {
    const v = values[key]?.trim();
    if (v) {
      out[key] = v;
    }
  }
  return out;
}

export function clarificationAnswersComplete(
  questions: ClarificationQuestion[],
  values: Record<string, string>,
): boolean {
  if (questions.length === 0) {
    return Object.entries(values).some(
      ([k, v]) => !RESERVED_ANSWER_KEYS.has(k) && v.trim().length > 0,
    );
  }
  return questions.every((q) => {
    if (!clarificationQuestionRequired(q)) {
      return true;
    }
    const raw = values[q.key]?.trim() ?? "";
    if (!raw) {
      return false;
    }
    // Outline HITL: non-empty free text is not enough — need a clear decision.
    if (q.key === "research_outline_confirm") {
      const decision = outlineAnswerDecision(raw);
      return decision === "approved" || decision === "revise" || decision === "rejected";
    }
    return true;
  });
}

export function formatClarificationResumeMessage(
  answers: Record<string, string>,
  questions: ClarificationQuestion[],
): string {
  const pins = collectClarificationFilePins(answers);
  const sessions = collectClarificationSessionRefs(answers);
  const prefix =
    formatClarificationFilePinsPrefix(pins) + formatClarificationSessionRefsPrefix(sessions);
  const lines: string[] = ["【补充信息】"];
  for (const q of questions) {
    const a = answers[q.key]?.trim();
    if (!a) {
      continue;
    }
    lines.push(`${q.question}\n答：${displayClarificationAnswer(q, a)}`);
  }
  // Outline HITL: only explicit approve/revise marks approved (not any non-empty answer).
  if (answers.research_outline_confirm?.trim()) {
    const decision = outlineAnswerDecision(answers.research_outline_confirm);
    if (decision === "approved" || decision === "revise") {
      lines.push("大纲已确认");
    } else if (decision === "rejected") {
      lines.push("大纲未通过，请重新生成大纲");
    } else {
      lines.push("大纲答复待明确：请写「大纲已确认」，或粘贴修订后的 ## 大纲 条目");
    }
  }
  if (lines.length === 1 && !prefix) {
    return "【补充信息】（律师已确认继续）";
  }
  if (lines.length === 1) {
    return `${prefix}【补充信息】（律师已挂接材料/对话并确认继续）`;
  }
  return `${prefix}${lines.join("\n\n")}`;
}

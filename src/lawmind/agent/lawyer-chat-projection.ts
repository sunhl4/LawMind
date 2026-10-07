/**
 * Lawyer transcript: one typed utterance, one answer window.
 *
 * Model history keeps every round (tool calls, compact anchors, bounce notes).
 * The desktop bubbles do not. Synthetic user notes stay off-screen. Status
 * lines the model writes before the next tool stay in history for the model;
 * the lawyer sees the prose that follows the last tool round, in one bubble.
 */

import { isCompactSyntheticUserMessage } from "./compact-insert.js";
import type { AgentMessage, PersistedChatLiveTrace } from "./types.js";

export type LawyerChatBubble = {
  role: "user" | "assistant";
  text: string;
  /** First conversationHistory index that belongs to this bubble. */
  historyIndex: number;
  /** Exclusive end. Trailing tool rows of an answer are included; the next user message is not. */
  historyEndExclusive: number;
  liveTrace?: PersistedChatLiveTrace;
  executionState?: AgentMessage["executionState"];
  turnPlan?: AgentMessage["turnPlan"];
};

function lawyerTypedText(msg: AgentMessage): string {
  const typed = msg.lawyerVisibleText?.trim();
  if (typed) {
    return typed;
  }
  return (msg.content ?? "").trim();
}

const OFFICE_PATH_RE = /((?:[^\s`"'<>[\]()]+\/)*[^\s`"'<>[\]()]+\.(?:docx?|xlsx?|pptx?|pdf|wps))/iu;

function officePathBasename(rel: string): string {
  const parts = rel.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || rel;
}

/** 反引号里的 Word/表格路径改成可点 Markdown，避免律师只看见灰色代码字。 */
function linkifyBacktickedOfficePaths(text: string): string {
  return text.replace(/`([^`\n]+)`/g, (all, inner: string) => {
    const raw = inner
      .trim()
      .replace(/^\*+|\*+$/g, "")
      .replace(/\*\*/g, "");
    const match = OFFICE_PATH_RE.exec(raw);
    if (!match?.[1] || match[1] !== raw) {
      return all;
    }
    const rel = match[1].replace(/\\/g, "/");
    if (rel.includes("..") || rel.startsWith("/") || rel.includes(":")) {
      return all;
    }
    return `[${officePathBasename(rel)}](${rel})`;
  });
}

/** 给律师看的技术旁白：notes 文字稿、修订 manifest、json 路径。历史原文不动。 */
function isLawyerHiddenTechLine(line: string): boolean {
  const t = line.trim();
  if (!t) {
    return false;
  }
  if (/\.redline-manifest\.json\b/i.test(t)) {
    return true;
  }
  if (/\bnotes\//i.test(t)) {
    return true;
  }
  if (/隐藏文件|修订记录，不用管|redline-manifest/i.test(t) && /\.json\b/i.test(t)) {
    return true;
  }
  // 纯 md/json 技术路径行（含表格单元格）；同行若还有 Word 则保留。
  if (/\.(?:md|json)\b/i.test(t) && !/\.(?:docx?|xlsx?|pptx?|pdf|wps)\b/i.test(t)) {
    return true;
  }
  return false;
}

function isGfmTableFurniture(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) {
    return false;
  }
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t)) {
    return true;
  }
  // 文字稿对照表表头
  if (/文件/.test(t) && /内容/.test(t)) {
    return true;
  }
  return false;
}

function isNotesInventoryHeading(line: string): boolean {
  const t = line.trim();
  if (/文字稿/i.test(t) && (/notes\//i.test(t) || /Markdown/i.test(t))) {
    return true;
  }
  return /^#{0,3}\s*[一二三四五六七八九十百千零〇\d]+[、.．]\s*.*文字稿/.test(t);
}

/** 丢掉「文字稿 / notes」清单标题及其后的表格、空行，遇到正常句子就停。 */
function stripNotesInventoryBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!isNotesInventoryHeading(line)) {
      out.push(line);
      i += 1;
      continue;
    }
    i += 1;
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      const t = cur.trim();
      if (
        !t ||
        isLawyerHiddenTechLine(cur) ||
        isGfmTableFurniture(cur) ||
        (t.startsWith("|") && /\.(?:md|json)\b/i.test(t))
      ) {
        i += 1;
        continue;
      }
      break;
    }
  }
  return out.join("\n");
}

function stripEngineMeasurementBlocks(text: string): string {
  const markers = [
    "【机械核定】",
    "【引擎核定】",
    "【约化因子】",
    "【骨架起点】",
    "【因子修复】",
    "【定义环】",
    "【引用原文】",
  ];
  let next = text;
  let sawGap = false;
  for (const marker of markers) {
    let at = next.indexOf(marker);
    while (at >= 0) {
      if (next.slice(at).includes("待核实") || next.slice(at).includes("待确认")) {
        sawGap = true;
      }
      const head = next.slice(0, at).trimEnd();
      const lines = next.slice(at).split("\n");
      let i = 1;
      while (i < lines.length) {
        const line = lines[i] ?? "";
        const trimmed = line.trim();
        if (
          !trimmed ||
          /^\s*- /.test(line) ||
          /^(?:amount|citation|party|negation|defined|clause|redline):/.test(trimmed)
        ) {
          i += 1;
          continue;
        }
        break;
      }
      const tail = lines.slice(i).join("\n").trim();
      next = [head, tail].filter(Boolean).join("\n\n");
      at = next.indexOf(marker);
    }
  }
  next = next
    .split("\n")
    .filter(
      (line) => !/^(?:amount|citation|party|negation|defined|clause|redline):/.test(line.trim()),
    )
    .join("\n");
  if (sawGap && !next.includes("待确认") && !next.includes("待核实")) {
    const gap = "有几处数字、引用或措辞还对不上材料，已留在文中，请在修订里改。";
    next = next.trim() ? `${next.trim()}\n\n${gap}` : gap;
  }
  return next;
}

/**
 * Drop digest inventory and engineer-facing notes/json pointers the model may echo.
 * Lawyers see the answer and Word links; tool lists and notes paths stay in history
 * for the next model turn.
 */
export function scrubLawyerFacingAssistantText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  let next = stripEngineMeasurementBlocks(trimmed)
    .replace(/\n*###\s*曾调用工具\s*\n[\s\S]*?(?=\n###\s|\s*$)/g, "")
    .replace(/\n*###\s*压缩前引用\s*\n[\s\S]*?(?=\n###\s|\s*$)/g, "");

  next = next.replace(
    /[（(]另有[^）)]*(?:\.json|redline-manifest|隐藏文件|修订记录)[^）)]*[）)]/g,
    "",
  );

  // 推诿「审核台放行才能出 Word」：历史里可能残留，律师面拿掉。
  next = next
    .split("\n")
    .filter(
      (line) =>
        !(
          /审核台/.test(line) &&
          /放行/.test(line) &&
          /(?:出\s*Word|导出|出稿|才能出)/i.test(line)
        ) && !/(?:改稿与导出工具未开|导出工具未开)/.test(line),
    )
    .join("\n");

  next = stripNotesInventoryBlocks(next);

  next = next
    .split("\n")
    .filter((line) => !isLawyerHiddenTechLine(line))
    .join("\n");

  next = linkifyBacktickedOfficePaths(next);

  next = next
    .replace(/，不用再回复继续。/g, "。")
    .replace(/不用再回复继续。/g, "")
    .replace(/然后回复「继续」。/g, "")
    .replace(/请回复「继续」。/g, "");

  return next
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A user row the lawyer actually sent. Compact anchors and bounce notes are not. */
export function isLawyerTypedUserMessage(msg: AgentMessage): boolean {
  if (msg.role !== "user" || msg.hiddenFromLawyer) {
    return false;
  }
  if (isCompactSyntheticUserMessage(msg.content ?? "")) {
    return false;
  }
  return lawyerTypedText(msg).length > 0;
}

function assistantContributesToBubble(msg: AgentMessage): boolean {
  if (msg.role !== "assistant" || msg.hiddenFromLawyer) {
    return false;
  }
  const text = (msg.content ?? "").trim();
  return text.length > 0 || (msg.liveTrace?.steps?.length ?? 0) > 0 || msg.turnPlan != null;
}

/**
 * Prose after the last tool round. Narration that sits on a tool call is process,
 * same as Codex keeping tool rounds in the model transcript and showing one answer.
 */
function lawyerAnswerText(
  history: readonly AgentMessage[],
  visible: Array<{ msg: AgentMessage; index: number }>,
): string {
  let lastToolRound = -1;
  for (let i = 0; i < visible.length; i += 1) {
    const row = visible[i];
    const next = visible[i + 1];
    if (!row) {
      continue;
    }
    const calledTools = (row.msg.toolCalls?.length ?? 0) > 0;
    const toolBeforeNext = next
      ? history.slice(row.index + 1, next.index).some((msg) => msg?.role === "tool")
      : false;
    if (calledTools || toolBeforeNext) {
      lastToolRound = i;
    }
  }
  return scrubLawyerFacingAssistantText(
    visible
      .slice(lastToolRound + 1)
      .map((row) => (row.msg.content ?? "").trim())
      .filter((text) => text.length > 0)
      .join("\n\n"),
  );
}

/** Stop before the next user row so a compact note sitting in front of it is kept for the model. */
function assistantSpanEnd(
  history: readonly AgentMessage[],
  lastAssistantIndex: number,
  nextBoundary: number,
): number {
  let end = lastAssistantIndex + 1;
  while (end < nextBoundary) {
    const msg = history[end];
    if (!msg || msg.role === "user") {
      break;
    }
    end += 1;
  }
  return end;
}

/**
 * Pair the persisted history into desktop bubbles.
 * Consecutive assistant rounds after one typed user message become one bubble.
 * The next typed user message starts a new pair, so two questions never share one answer.
 */
export function projectLawyerChatBubbles(history: readonly AgentMessage[]): LawyerChatBubble[] {
  const bubbles: LawyerChatBubble[] = [];
  let run: Array<{ msg: AgentMessage; index: number }> = [];

  const flush = (nextBoundary: number): void => {
    const visible = run.filter((row) => assistantContributesToBubble(row.msg));
    run = [];
    if (visible.length === 0) {
      return;
    }
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (!first || !last) {
      return;
    }
    let executionState: AgentMessage["executionState"];
    let turnPlan: AgentMessage["turnPlan"];
    for (const row of visible) {
      if (row.msg.executionState) {
        executionState = row.msg.executionState;
      }
      if (row.msg.turnPlan) {
        turnPlan = row.msg.turnPlan;
      }
    }
    bubbles.push({
      role: "assistant",
      text: lawyerAnswerText(history, visible),
      historyIndex: first.index,
      historyEndExclusive: assistantSpanEnd(history, last.index, nextBoundary),
      ...(executionState ? { executionState } : {}),
      ...(turnPlan ? { turnPlan } : {}),
    });
  };

  for (let index = 0; index < history.length; index += 1) {
    const msg = history[index];
    if (!msg) {
      continue;
    }
    if (isLawyerTypedUserMessage(msg)) {
      flush(index);
      bubbles.push({
        role: "user",
        text: lawyerTypedText(msg),
        historyIndex: index,
        historyEndExclusive: index + 1,
      });
      continue;
    }
    if (msg.role === "assistant" && !msg.hiddenFromLawyer) {
      run.push({ msg, index });
    }
  }
  flush(history.length);
  return bubbles;
}

/**
 * 给律师的收口。
 *
 * 格式税（Tam 等 2024《Let Me Speak Freely?》；2026《The Format Tax》，arXiv:2604.03616）：
 * 在提示里要求整段改成 JSON，推理和文笔的损失主要发生在提示，而不是解码器。
 * 律师看到的就是模型写的句子。程序只做两件事后处理：
 * 删掉核对黑话所在的行；若模型只交了旧的 lm-close 槽位、没有正文，才用槽位兜底渲染。
 */

import { z } from "zod";
import { isDraftTaskId, statuteJumpUrl } from "../sources/lawyer-chat-link.js";
import { spliceRetrievedAnchors, type RetrievedAnchors } from "./lawyer-close-anchors.js";

export const LAWYER_CLOSE_RULES = `### 收口三句

稿已经写出，或这一轮不能再改时，用你自己的句子写给律师。不要改成 JSON、表格或核对报告。系统不会把你的话重写成填空。

按这个次序写，每块都写成完整的话：

**稿**
哪些稿还在草稿里、没有出 Word、没有外发。知道任务编号时，把标题嵌进句子：\`[文书标题](lm-draft:任务编号)\`。

**意见**
先写结论，把理由写完。条款写成《法律名称》第N条，嵌在这句里。系统会把本轮检索到的原文地址补在这几个字上，不要为了加链接改句子，也不要编地址。没有检索到就注明原文待核。不要另写一份法条文稿，也不要做画布。

**请您定**
只写材料里没有、而且会改变下一稿的事实或选择，让律师能用一句话回复。期限、单价、比例另起一句，标明不挡住现在的意见。

不要复述核对过程，不要请律师放行核对。核对单套错了合同类型时，不要写。`;

/** 核对器自己的话。槽位和正文里碰到就丢掉。 */
const HIDDEN_GAP_RE =
  /guardian|checklist|usedIn|writerDeferred|sameTurn|hunk|sections\s*为空|检查单|审稿员|门禁|落改|验证器|独立审稿|轮未过|错误码|itemId|pr\.|loan\.|maxRounds|citation_insufficient|no_checklist/i;

export function lawyerVisibleGaps(gaps: string[]): string[] {
  const out: string[] = [];
  for (const raw of gaps) {
    const line = raw.trim();
    if (!line || HIDDEN_GAP_RE.test(line)) {
      continue;
    }
    if (!out.includes(line)) {
      out.push(line);
    }
  }
  return out.slice(0, 6);
}

const WORD_CHECK_RE = /\[\[word-check:([A-Za-z0-9._-]+)\]\]/g;
const CLOSE_FENCE_RE = /```lm-close\s*([\s\S]*?)```/gi;

const closeSchema = z.object({
  drafts: z
    .array(
      z.object({
        title: z.string(),
        taskId: z.string().optional(),
      }),
    )
    .optional(),
  opinions: z
    .array(
      z.object({
        text: z.string(),
        statute: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
  decisions: z.array(z.string()).optional(),
  commercialBlanks: z.array(z.string()).optional(),
});

export type LawyerClose = {
  drafts: Array<{ title: string; taskId?: string }>;
  opinions: Array<{ text: string; statute?: string; url?: string }>;
  decisions: string[];
  commercialBlanks: string[];
};

function cleanSlot(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > max || HIDDEN_GAP_RE.test(text)) {
    return "";
  }
  return text;
}

function parseCloseJson(raw: string): LawyerClose | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = closeSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const drafts: LawyerClose["drafts"] = [];
  for (const row of parsed.data.drafts ?? []) {
    const title = cleanSlot(row.title, 200);
    if (!title) {
      continue;
    }
    const taskId = row.taskId?.trim();
    drafts.push(taskId && isDraftTaskId(taskId) ? { title, taskId } : { title });
  }
  const opinions: LawyerClose["opinions"] = [];
  for (const row of parsed.data.opinions ?? []) {
    const text = cleanSlot(row.text, 400);
    if (!text) {
      continue;
    }
    const statute = row.statute ? cleanSlot(row.statute, 200) : "";
    const url = row.url?.trim() ?? "";
    const safeUrl = statute && url ? statuteJumpUrl(url, statute) : null;
    opinions.push({
      text,
      ...(statute ? { statute } : {}),
      ...(safeUrl ? { url: safeUrl } : {}),
    });
  }
  const decisions = (parsed.data.decisions ?? [])
    .map((line) => cleanSlot(line, 240))
    .filter(Boolean)
    .slice(0, 8);
  const commercialBlanks = (parsed.data.commercialBlanks ?? [])
    .map((line) => cleanSlot(line, 120))
    .filter(Boolean)
    .slice(0, 8);
  const close = {
    drafts: drafts.slice(0, 12),
    opinions: opinions.slice(0, 12),
    decisions,
    commercialBlanks,
  };
  if (
    close.drafts.length +
      close.opinions.length +
      close.decisions.length +
      close.commercialBlanks.length ===
    0
  ) {
    return null;
  }
  return close;
}

function lastCloseFence(text: string): string | null {
  let raw: string | null = null;
  for (const match of text.matchAll(CLOSE_FENCE_RE)) {
    raw = match[1]?.trim() ?? null;
  }
  return raw;
}

/** 仅当回复里没有律师能读的正文时，用槽位兜底。正常收口不走这里。 */
export function renderLawyerClose(close: LawyerClose): string {
  const lines = ["稿还在草稿里，没有出 Word，也没有外发。"];
  if (close.drafts.length > 0) {
    lines.push("");
    for (const draft of close.drafts) {
      lines.push(
        draft.taskId ? `- [${draft.title}](lm-draft:${draft.taskId})` : `- ${draft.title}`,
      );
    }
  }
  if (close.opinions.length > 0) {
    lines.push("", "意见");
    for (const opinion of close.opinions) {
      const safeUrl =
        opinion.statute && opinion.url ? statuteJumpUrl(opinion.url, opinion.statute) : null;
      if (opinion.statute && safeUrl) {
        lines.push(`- ${opinion.text} [${opinion.statute}](${safeUrl})`);
      } else if (opinion.statute) {
        lines.push(`- ${opinion.text} 依据：${opinion.statute}（原文待核）`);
      } else {
        lines.push(`- ${opinion.text}`);
      }
    }
  }
  if (close.decisions.length > 0) {
    lines.push("", "请您定");
    close.decisions.forEach((line, index) => {
      lines.push(`${index + 1}. ${line}`);
    });
  }
  if (close.commercialBlanks.length > 0) {
    lines.push("", `还要向客户要的数字：${close.commercialBlanks.join("、")}。不挡住现在的意见。`);
  }
  return lines.join("\n");
}

function stripCloseFences(text: string): string {
  return text
    .replace(/```lm-close[\s\S]*?```/gi, "")
    .replace(/```lm-close[\s\S]*$/i, "")
    .trim();
}

function stripLeakLines(text: string): { text: string; dropped: boolean } {
  const kept: string[] = [];
  let dropped = false;
  for (const line of text.split("\n")) {
    if (HIDDEN_GAP_RE.test(line)) {
      dropped = true;
      continue;
    }
    kept.push(line);
  }
  const next = kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: next, dropped };
}

const FALLBACK_CLOSE = "稿还在草稿里，没有出 Word，也没有外发。需要您定的事，直接回复即可。";

/**
 * 律师可见回复的出口。保留模型写的句子，只删核对黑话和旧槽位块。
 * 删完若没有正文，才用槽位兜底，避免律师只看见 JSON。
 */
export function constrainLawyerVisibleReply(text: string, anchors?: RetrievedAnchors): string {
  const markers: string[] = [];
  const body = text
    .replace(WORD_CHECK_RE, (all) => {
      markers.push(all);
      return "";
    })
    .trim();
  const fenced = lastCloseFence(body);
  const parsed = fenced ? parseCloseJson(fenced) : null;
  const prose = stripCloseFences(body);
  const stripped = stripLeakLines(prose);
  const hadFence = prose !== body.trim();
  let next = body;
  if (stripped.text) {
    next = stripped.dropped || hadFence ? stripped.text : body;
  } else if (parsed) {
    next = renderLawyerClose(parsed);
  } else if (stripped.dropped || hadFence) {
    next = FALLBACK_CLOSE;
  }
  if (anchors) {
    next = spliceRetrievedAnchors(next, anchors);
  }
  if (markers.length === 0) {
    return next;
  }
  return `${next}\n\n${markers.join("\n")}`.trim();
}

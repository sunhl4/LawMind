/**
 * Desk 三个动词：审这份 / 写这封 / 查这个问题。
 * 路由、等待文案、空态卡片、Word 侧车共用这一套，避免各写各的关键词。
 */

import type { TaskKind } from "../types.js";

export type DeskVerb = "review" | "draft" | "research";

export type DeskVerbCard = {
  verb: DeskVerb;
  label: string;
  description: string;
  prompt: string;
};

export const DESK_VERBS: readonly DeskVerbCard[] = [
  {
    verb: "review",
    label: "审这份",
    description: "合同、条款、风险",
    prompt: "审这份：请对以下合同或条款做风险审查，逐条标出问题与改法：\n\n",
  },
  {
    verb: "draft",
    label: "写这封",
    description: "律师函、合同、诉状",
    prompt: "写这封：请根据以下事实起草可外发文书：\n\n",
  },
  {
    verb: "research",
    label: "查这个问题",
    description: "法条、类案、司法解释",
    prompt: "查这个问题：请检索以下法律问题的法规、司法解释与类案：\n\n",
  },
];

export function inferDeskVerb(text: string): DeskVerb | undefined {
  const t = text.replace(/\s+/g, "");
  if (!t) {
    return undefined;
  }
  if (/(审这份|审查这份|审一下这份)/.test(t)) {
    return "review";
  }
  if (/(写这封|起草这封|写一份这)/.test(t)) {
    return "draft";
  }
  if (/(查这个问题|查一下这个问题)/.test(t)) {
    return "research";
  }
  return undefined;
}

export function deskVerbFromKind(kind: TaskKind): DeskVerb | undefined {
  if (kind === "analyze.contract") {
    return "review";
  }
  if (kind === "draft.word" || kind === "draft.ppt") {
    return "draft";
  }
  if (kind.startsWith("research") || kind === "summarize.case") {
    return "research";
  }
  return undefined;
}

export function taskKindForDeskVerb(verb: DeskVerb): TaskKind {
  if (verb === "review") {
    return "analyze.contract";
  }
  if (verb === "draft") {
    return "draft.word";
  }
  return "research.legal";
}

export function deskVerbCard(verb: DeskVerb): DeskVerbCard {
  const card = DESK_VERBS.find((row) => row.verb === verb);
  if (!card) {
    return DESK_VERBS[2];
  }
  return card;
}

export function composeSidecarPrompt(verb: DeskVerb, selection: string): string {
  const card = deskVerbCard(verb);
  return `${card.prompt}${selection.trim()}`;
}

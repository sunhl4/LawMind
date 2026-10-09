/**
 * Shape checks for two instruction frames only.
 * Case-analysis frames (【结论】【案情简述】 before the fact body) never match.
 * The model still chooses the words.
 */

import fs from "node:fs";
import path from "node:path";
import { namedWorkspaceDeliverables } from "./named-deliverable.js";

export const PLEADING_SECTION_MARKER = "【诉状要件】";

export const CONSULT_QUESTIONS_MARKER = "【追问清单】";

/** Numbered lines below this count are not a follow-up list. */
export const CONSULT_QUESTION_MIN = 8;

const QUESTION_LINE_RE = /^\s*(?:\d{1,2}[.、．)]|（\d{1,2}）)\s*\S+/;

/** Task sentence only. Facts after a blank line must not flip the gate. */
export function taskFrame(instruction: string): string {
  const trimmed = instruction.trim();
  const first = trimmed.split(/\n\s*\n/)[0] ?? trimmed;
  return first.slice(0, 800);
}

function caseAnalysisFrame(frame: string): boolean {
  return frame.includes("【结论】") && frame.includes("【案情简述】");
}

export function instructionFramesPleading(instruction: string): boolean {
  const frame = taskFrame(instruction);
  if (caseAnalysisFrame(frame)) {
    return false;
  }
  const named = namedWorkspaceDeliverables(instruction);
  if (named.length === 0) {
    return false;
  }
  if (named.some((name) => /起诉状|答辩状/.test(name))) {
    return true;
  }
  return /(?:撰写|起草|写).{0,16}(?:民事)?(?:起诉状|答辩状)/.test(frame);
}

export function instructionFramesConsultQuestions(instruction: string): boolean {
  const frame = taskFrame(instruction);
  if (caseAnalysisFrame(frame)) {
    return false;
  }
  return /只列出.{0,16}追问|不要给完整法律意见/.test(frame);
}

export function missingPleadingSections(text: string): string[] {
  const missing: string[] = [];
  if (!/诉讼请求|答辩请求/.test(text)) {
    missing.push("诉讼请求或答辩请求");
  }
  for (const marker of ["事实", "理由", "证据"] as const) {
    if (!text.includes(marker)) {
      missing.push(marker);
    }
  }
  return missing;
}

export function consultQuestionCount(text: string): number {
  let count = 0;
  for (const line of text.split(/\n/)) {
    if (QUESTION_LINE_RE.test(line)) {
      count += 1;
    }
  }
  return count;
}

export function consultListNeedsRewrite(text: string): boolean {
  return consultQuestionCount(text) < CONSULT_QUESTION_MIN;
}

export function readNamedDeliverable(
  workspaceDir: string,
  instruction: string,
): {
  present: boolean;
  text: string;
} {
  const root = path.resolve(workspaceDir);
  for (const rel of namedWorkspaceDeliverables(instruction)) {
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
      continue;
    }
    if (!fs.existsSync(abs)) {
      continue;
    }
    try {
      return { present: true, text: fs.readFileSync(abs, "utf8").slice(0, 80_000) };
    } catch {
      return { present: true, text: "" };
    }
  }
  return { present: false, text: "" };
}

export function pleadingSectionGaps(workspaceDir: string, instruction: string): string[] {
  if (!instructionFramesPleading(instruction)) {
    return [];
  }
  const body = readNamedDeliverable(workspaceDir, instruction);
  if (!body.present) {
    return [];
  }
  return missingPleadingSections(body.text);
}

export function consultListGap(workspaceDir: string, instruction: string): boolean {
  if (!instructionFramesConsultQuestions(instruction)) {
    return false;
  }
  const body = readNamedDeliverable(workspaceDir, instruction);
  if (!body.present) {
    return false;
  }
  return consultListNeedsRewrite(body.text);
}

export function formatPleadingSectionNudge(missing: readonly string[]): string {
  return [
    PLEADING_SECTION_MARKER,
    `稿里还缺：${missing.join("、")}。`,
    "用 write_document 把同一份起诉状或答辩状补全。诉讼请求或答辩请求、事实、理由、证据都要有。",
    "检索结果里已经出现的条号照写。本回合不要再检索。",
  ].join("\n");
}

export function formatConsultQuestionsNudge(paths: readonly string[]): string {
  const list = paths.join("、");
  return [
    CONSULT_QUESTIONS_MARKER,
    `用 write_document 重写 ${list}。`,
    "只写 10–25 条编号追问。不要写法律意见、诉讼请求或法条分析。",
  ].join("\n");
}

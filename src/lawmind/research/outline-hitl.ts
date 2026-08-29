/**
 * Real outline HITL: explicit approve / reject / revise (not "any non-empty answer").
 */

import type { ResearchOutline, ResearchOutlineSection } from "./research-outline.js";

export type OutlineAnswerDecision = "approved" | "rejected" | "revise" | "unclear";

const REJECT_RE =
  /^(不同意|不确认|拒绝|重写|否|不要|reject|no)\b|不同意大纲|大纲不对|请重写大纲|推倒重来/i;
const APPROVE_RE =
  /(大纲已确认|确认大纲|approve.?outline|outline.?approved|按此大纲|同意此大纲|可以按此大纲|按上述大纲)/i;
/** Short affirmatives for clarification-card answers only (via 【补充信息】). */
const SHORT_AFFIRM_RE = /^(确认|同意|ok|okay|yes|通过)\s*[。.!！]?$/i;

export function outlineAnswerDecision(answer: string): OutlineAnswerDecision {
  const t = answer.trim();
  if (!t) {
    return "unclear";
  }
  if (REJECT_RE.test(t)) {
    return "rejected";
  }
  if (APPROVE_RE.test(t) || SHORT_AFFIRM_RE.test(t)) {
    // Prefer revise when body also contains a structured outline dump.
    if (/^##\s+/m.test(t) && t.split("\n").filter((l) => l.startsWith("- ")).length >= 2) {
      return "revise";
    }
    return "approved";
  }
  if (/^##\s+/m.test(t) || (t.includes("\n- ") && t.length > 40)) {
    return "revise";
  }
  return "unclear";
}

/** Parse lawyer-edited outline markdown (## heading + - bullets) into sections. */
export function parseOutlineMarkdownSections(md: string): ResearchOutlineSection[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections: ResearchOutlineSection[] = [];
  let current: ResearchOutlineSection | null = null;
  let idx = 0;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+)$/);
    if (h?.[1]) {
      if (current) {
        sections.push(current);
      }
      idx += 1;
      current = {
        id: `edited-${idx}`,
        heading: h[1].trim(),
        purpose: "律师修订",
        bullets: [],
      };
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet?.[1] && current) {
      current.bullets.push(bullet[1].trim());
    }
  }
  if (current) {
    sections.push(current);
  }
  return sections.filter((s) => s.heading.length > 0);
}

/**
 * Apply clarification answer to an outline: approve / reject / revise sections.
 * Returns null when the answer is unclear (caller should keep pending + re-ask).
 */
export function applyOutlineClarificationAnswer(
  outline: ResearchOutline,
  answer: string,
): ResearchOutline | null {
  const decision = outlineAnswerDecision(answer);
  if (decision === "unclear" || decision === "rejected") {
    return null;
  }
  const parsed = parseOutlineMarkdownSections(answer);
  const sections = parsed.length > 0 ? parsed : outline.sections;
  return {
    ...outline,
    status: "approved",
    sections,
    notes: [...outline.notes, decision === "revise" ? "律师修订并确认大纲" : "律师确认大纲"],
  };
}

/**
 * True only for structured clarification resumes — never bare phrases in the
 * lawyer's first ask (avoids skipping HITL when the instruction casually says「确认大纲」).
 */
export function outlineLooksApproved(instruction: string): boolean {
  if (!/【补充信息】/.test(instruction)) {
    return false;
  }
  if (/大纲已确认/.test(instruction)) {
    return true;
  }
  const answer = extractOutlineAnswerFromResume(instruction);
  if (!answer) {
    return false;
  }
  const decision = outlineAnswerDecision(answer);
  return decision === "approved" || decision === "revise";
}

/** Extract the lawyer's outline answer text from a clarification resume message. */
export function extractOutlineAnswerFromResume(instruction: string): string | undefined {
  if (!/【补充信息】/.test(instruction)) {
    return undefined;
  }
  // Prefer the block answering the outline question.
  const m = instruction.match(
    /请确认或调整研究大纲[\s\S]*?\n答：\s*([\s\S]*?)(?:\n\n大纲已确认|\n\n请确认|$)/,
  );
  if (m?.[1]?.trim()) {
    return m[1].trim();
  }
  if (/大纲已确认/.test(instruction)) {
    return "大纲已确认";
  }
  return undefined;
}

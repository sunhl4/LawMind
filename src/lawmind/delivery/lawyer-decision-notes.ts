/**
 * Judgment items travel with the deliverable. They do not block export and
 * they are not engine errors. Mechanical Word/lint failures stay internal.
 */

import { classifyResidual } from "../lint/self-revise.js";
import type { LegalLintFinding } from "../lint/types.js";
import type { ArtifactDraft, ArtifactSection } from "../types.js";

const DECISION_HEADING = "需您定夺";

export function lawyerDecisionLines(findings: LegalLintFinding[]): string[] {
  const { residualSubjective } = classifyResidual(findings);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const finding of residualSubjective) {
    const message = finding.message.trim();
    if (!message || seen.has(message)) {
      continue;
    }
    seen.add(message);
    lines.push(message.startsWith("需您定夺") ? message : `需您定夺：${message}`);
  }
  return lines;
}

function sectionBody(lines: string[]): string {
  return lines.join("\n");
}

function upsertSection(sections: ArtifactSection[], lines: string[]): void {
  const body = sectionBody(lines);
  const existing = sections.find((section) => section.heading === DECISION_HEADING);
  if (existing) {
    existing.body = body;
    return;
  }
  sections.push({ heading: DECISION_HEADING, body });
}

/**
 * New documents get a trailing section. A tracked contract body is left
 * unchanged so the note is not written into the counterparty's text.
 * Returns the lines that were recorded (empty when there is nothing to decide).
 */
export function attachLawyerDecisionNotes(
  draft: ArtifactDraft,
  findings: LegalLintFinding[],
): string[] {
  const lines = lawyerDecisionLines(findings);
  if (lines.length === 0) {
    return [];
  }
  if (draft.contractEdit) {
    if (draft.pairedOpinionSections?.length) {
      upsertSection(draft.pairedOpinionSections, lines);
    }
    return lines;
  }
  upsertSection(draft.sections, lines);
  return lines;
}

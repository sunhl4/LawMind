/**
 * Match enabled local skills to a triage/workflow recommendation.
 */

import type { SkillMeta } from "./skill-runtime.js";

export type SkillMatchInput = {
  recommendedWorkflowId?: string;
  text?: string;
  deliverableTypeHint?: string;
};

/** Prefer skills whose workflowIds / tags intersect the recommended workflow. */
export function matchSkillsForTriage(skills: SkillMeta[], input: SkillMatchInput): SkillMeta[] {
  const wf = (input.recommendedWorkflowId ?? "").trim();
  const text = (input.text ?? "").toLowerCase();
  const hint = (input.deliverableTypeHint ?? "").toLowerCase();
  const enabled = skills.filter((s) => s.enabled && s.signatureOk);
  if (!enabled.length) {
    return [];
  }

  const scored = enabled.map((s) => {
    let score = 0;
    const tags = [...(s.workflowIds ?? []), ...(s.tags ?? [])].map((t) => t.toLowerCase());
    if (wf && tags.some((t) => t === wf.toLowerCase() || wf.toLowerCase().includes(t))) {
      score += 10;
    }
    if (hint && tags.some((t) => hint.includes(t) || t.includes(hint))) {
      score += 4;
    }
    if (
      text &&
      (s.description
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.length > 2 && text.includes(w)) ||
        tags.some((t) => text.includes(t)))
    ) {
      score += 2;
    }
    return { s, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .toSorted((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id))
    .map((x) => x.s);
}

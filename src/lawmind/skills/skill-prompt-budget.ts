/**
 * Lean skill injection: dump up to 2 primary stage bodies, index the rest.
 */

import type { BoundLawyerCapability } from "./lawyer-capabilities.js";
import { readBuiltinSkillMarkdown } from "./lawyer-capabilities.js";
import { litigationPrimary } from "./litigation-primary.js";

const PRIMARY_BY_CAPABILITY: Record<string, readonly string[]> = {
  "contract.review": ["contract-review-layers", "contract-redline-craft"],
  "contract.draft": ["contract-drafting-route", "practice-defaults"],
  "mail.contract": ["contract-review-layers", "citation-grounding"],
  "letter.draft": ["delivery-language", "legal-element-extraction"],
  "research.memo": ["research-query-matrix", "citation-grounding"],
  "materials.draft": ["delivery-language", "legal-element-extraction"],
  "analysis.quick": ["quick-legal-triage", "legal-element-extraction"],
  "labor.calc": ["labor-compensation-calc"],
  "period.calc": ["legal-period-calc"],
  "chronology.timeline": ["chronology-two-stage", "chronology-from-materials"],
  "matter.intake": ["matter-from-materials", "matter-budget-lite"],
  "ops.invoice": ["invoice-organizer"],
  "ops.court_sms": ["court-sms-intake", "legal-event-extract"],
  "litigation.talk": ["client-talk-intake", "legal-element-extraction"],
  "ip.dispute": ["ip-dispute-route", "evidence-argument-chain"],
  "deal.ma": ["ma-diligence-route", "legal-element-extraction"],
  "compliance.data": ["data-compliance-route", "norm-validity"],
  "compliance.ads": ["ads-compliance-route", "norm-validity"],
  "matter.status": ["matter-status-report", "matter-status-scope-budget"],
  "family.matter": ["family-matter-route", "legal-element-extraction"],
  "capital.markets": ["capital-markets-route", "citation-grounding"],
  "corp.governance": ["governance-route", "norm-validity"],
};

export function primarySkillIdsForBound(
  bound: BoundLawyerCapability,
  instruction: string,
): string[] {
  const allowed = new Set(bound.skillIds);
  if (bound.id === "mail.contract") {
    const mail = ["contract-review-layers", "citation-grounding"].filter((id) => allowed.has(id));
    return mail.length > 0 ? mail : [...bound.skillIds].slice(0, 2);
  }
  if (bound.pipeline === "tracked_redline" && bound.id === "litigation.draft") {
    const head = [...bound.skillIds].filter((id) => allowed.has(id)).slice(0, 2);
    return head.length > 0 ? head : [...bound.skillIds].slice(0, 2);
  }
  const wanted =
    bound.id === "litigation.draft"
      ? litigationPrimary(instruction, bound.deliverableType)
      : [...(PRIMARY_BY_CAPABILITY[bound.id] ?? bound.skillIds)];
  const picked = wanted.filter((id) => allowed.has(id)).slice(0, 2);
  return picked.length > 0 ? picked : [...bound.skillIds].slice(0, 2);
}

export function skillIndexLine(skillId: string): string {
  const md = readBuiltinSkillMarkdown(skillId);
  if (!md) {
    return skillId;
  }
  const name = /^name:\s*(.+)$/m.exec(md)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(md)?.[1]?.trim();
  const label = description || name || skillId;
  return `${skillId}：${label}`;
}

export type LeanSkillPrompt = {
  primaryIds: string[];
  indexIds: string[];
  indexLines: string[];
};

export function planLeanSkillPrompt(
  bound: BoundLawyerCapability,
  instruction: string,
): LeanSkillPrompt {
  const primaryIds = primarySkillIdsForBound(bound, instruction);
  const primarySet = new Set(primaryIds);
  const indexIds = bound.skillIds.filter((id) => !primarySet.has(id));
  return {
    primaryIds,
    indexIds,
    indexLines: indexIds.map(skillIndexLine),
  };
}

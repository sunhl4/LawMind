/**
 * Lean skill injection: dump 1–2 stage bodies, index the rest.
 * Mail short path and Word tracked lock already have a short skillIds list — keep as-is.
 */

import type { BoundLawyerCapability } from "./lawyer-capabilities.js";
import { readBuiltinSkillMarkdown } from "./lawyer-capabilities.js";

const PRIMARY_BY_CAPABILITY: Record<string, readonly string[]> = {
  "contract.review": ["contract-review-layers", "contract-redline-craft"],
  "contract.draft": ["contract-drafting-route", "practice-defaults"],
  "mail.contract": ["citation-grounding", "delivery-language"],
  "letter.draft": ["delivery-language", "legal-element-extraction"],
  "research.memo": ["research-query-matrix", "citation-grounding"],
  "materials.draft": ["delivery-language", "legal-element-extraction"],
  "analysis.quick": ["quick-legal-triage", "legal-element-extraction"],
  "labor.calc": ["labor-compensation-calc"],
  "period.calc": ["legal-period-calc"],
  "chronology.timeline": ["chronology-from-materials"],
  "matter.intake": ["matter-from-materials", "matter-budget-lite"],
  "ops.invoice": ["invoice-organizer"],
  "ops.court_sms": ["court-sms-intake", "legal-event-extract"],
  "litigation.talk": ["client-talk-intake", "legal-element-extraction"],
  "ip.dispute": ["ip-dispute-route", "evidence-argument-chain"],
  "deal.ma": ["ma-diligence-route", "legal-element-extraction"],
  "compliance.data": ["data-compliance-route", "norm-validity"],
  "compliance.ads": ["ads-compliance-route", "norm-validity"],
  "matter.status": ["matter-status-report"],
  "family.matter": ["family-matter-route", "legal-element-extraction"],
  "capital.markets": ["capital-markets-route", "citation-grounding"],
  "corp.governance": ["governance-route", "norm-validity"],
};

function litigationPrimary(instruction: string, deliverableType?: string): string[] {
  if (/(离婚诉讼|抚养权|探望权|遗产继承|婚内财产分割|遗嘱继承)/.test(instruction)) {
    return ["family-matter-route", "legal-element-extraction"];
  }
  if (/(侦查阶段|审查起诉|取保候审|刑事辩护|死刑复核|会见申请|辩护词)/.test(instruction)) {
    return ["criminal-stage-route", "evidence-argument-chain"];
  }
  if (/(债权申报|破产重整|债权人会议|破产清算|重整计划)/.test(instruction)) {
    return ["bankruptcy-stage-route", "legal-period-calc"];
  }
  if (/(知产争议|专利侵权|商标侵权|著作权侵权|被控侵权)/.test(instruction)) {
    return ["ip-dispute-route", "evidence-argument-chain"];
  }
  if (deliverableType === "litigation.complaint" || /起诉状/.test(instruction)) {
    return ["complaint-elements-fill", "evidence-argument-chain"];
  }
  if (/(上诉状|执行异议|立案材料清单)/.test(instruction)) {
    return ["litigation-stage-route", "evidence-argument-chain"];
  }
  return ["litigation-stage-route", "complaint-elements-fill"];
}

export function primarySkillIdsForBound(
  bound: BoundLawyerCapability,
  instruction: string,
): string[] {
  if (bound.pipeline === "tracked_redline" || bound.id === "mail.contract") {
    return [...bound.skillIds];
  }
  const wanted =
    bound.id === "litigation.draft"
      ? litigationPrimary(instruction, bound.deliverableType)
      : [...(PRIMARY_BY_CAPABILITY[bound.id] ?? bound.skillIds.slice(0, 2))];
  const allowed = new Set(bound.skillIds);
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

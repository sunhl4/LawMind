/**
 * Heuristic deliverable type for acceptance when router/draft metadata is stale.
 * E.g. ESG reports mis-tagged as contract.rental or document.general.
 */

import type { ArtifactDraft, DeliverableType } from "../types.js";

const ESG_RE = /(esg|可持续发展|环境.?社会.?治理|csr|碳中和|碳排放|社会责任报告)/i;
const COMPLIANCE_RE = /(合规卷宗|管辖区效力|涉外合规|跨境合规|风险域发现)/;
const LEARNING_RE = /(调研简报|学习简报|制度要点|比较分析)/;
const TRAINING_RE = /(培训课件|课件大纲|脱敏声明|红旗清单)/;
const REPORT_RE = /(年度报告|研究报告|分析报告|白皮书|尽职调查报告|合规报告|专项报告)/;
const CONTRACTISH_RE = /(租赁合同|律师函|起诉状|答辩状|代理词|保密协议|法律意见|会议纪要|证据目录)/;

function draftHaystack(draft: ArtifactDraft): string {
  const parts: string[] = [draft.title ?? "", draft.summary ?? ""];
  for (const s of draft.sections) {
    parts.push(s.heading, s.body.slice(0, 400));
  }
  return parts.join("\n");
}

/** Resolve the deliverable type used for acceptance (may differ from draft.deliverableType). */
export function inferDeliverableTypeForAcceptance(
  draft: ArtifactDraft,
): DeliverableType | undefined {
  const explicit = draft.deliverableType;
  // Locked research types: never let ESG/report heuristics rewrite the lawyer's intent.
  if (
    explicit === "report.compliance" ||
    explicit === "report.learning" ||
    explicit === "ppt.training"
  ) {
    return explicit;
  }

  const haystack = draftHaystack(draft);

  const looksEsg = ESG_RE.test(haystack);
  const looksCompliance = COMPLIANCE_RE.test(haystack);
  const looksLearning = LEARNING_RE.test(haystack);
  const looksTraining = TRAINING_RE.test(haystack);
  const looksReport = REPORT_RE.test(haystack) && !CONTRACTISH_RE.test(haystack);

  if (looksEsg) {
    return "report.esg";
  }
  if (looksCompliance) {
    return "report.compliance";
  }
  if (looksTraining) {
    return "ppt.training";
  }
  if (looksLearning) {
    return "report.learning";
  }
  if (looksReport) {
    return "report.general";
  }

  if (
    explicit === "contract.rental" ||
    explicit === "contract.general" ||
    explicit === "letter.demand" ||
    explicit === "letter.counsel" ||
    explicit === "letter.reply" ||
    explicit === "litigation.outline" ||
    explicit === "litigation.complaint" ||
    explicit === "litigation.answer" ||
    explicit === "litigation.brief" ||
    explicit === "memo.opinion" ||
    explicit === "memo.internal" ||
    explicit === "memo.research" ||
    explicit === "labor.calc" ||
    explicit === "period.calc" ||
    explicit === "matter.timeline" ||
    explicit === "matter.exhibit_list" ||
    explicit === "meeting.minutes" ||
    explicit === "contract.nda"
  ) {
    return explicit;
  }

  return explicit;
}

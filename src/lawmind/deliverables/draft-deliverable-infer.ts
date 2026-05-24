/**
 * Heuristic deliverable type for acceptance when router/draft metadata is stale.
 * E.g. ESG reports mis-tagged as contract.rental or document.general.
 */

import type { ArtifactDraft, DeliverableType } from "../types.js";

const ESG_RE = /(esg|可持续发展|环境.?社会.?治理|csr|碳中和|碳排放|社会责任报告)/i;
const REPORT_RE = /(年度报告|研究报告|分析报告|白皮书|尽职调查报告|合规报告|专项报告)/;
const CONTRACTISH_RE = /(租赁合同|律师函|起诉状|答辩状|保密协议)/;

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
  const haystack = draftHaystack(draft);

  const looksEsg = ESG_RE.test(haystack);
  const looksReport = REPORT_RE.test(haystack) && !CONTRACTISH_RE.test(haystack);

  if (looksEsg) {
    return "report.esg";
  }
  if (looksReport) {
    return "report.general";
  }

  if (
    explicit === "contract.rental" ||
    explicit === "contract.general" ||
    explicit === "letter.demand"
  ) {
    return explicit;
  }

  return explicit;
}

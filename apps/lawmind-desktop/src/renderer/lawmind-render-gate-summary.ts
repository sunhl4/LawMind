import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";

/** Short inline summary when render / pack export is disabled. */
export function buildRenderGateSummary(input: {
  reviewStatus: ArtifactDraft["reviewStatus"] | undefined;
  acceptance: AcceptanceReport | null;
}): string | null {
  const review = input.reviewStatus ?? "pending";
  if (review !== "approved") {
    return `还差：签批通过（当前：${reviewLabel(review)}）`;
  }
  const acc = input.acceptance;
  if (acc?.deliverableType && !acc.ready) {
    const parts: string[] = [];
    if (acc.blockerCount > 0) {
      parts.push(`阻断 ${acc.blockerCount}`);
    }
    if (acc.warningCount > 0) {
      parts.push(`警告 ${acc.warningCount}`);
    }
    return `还差：验收门禁${parts.length ? `（${parts.join("，")}）` : ""}`;
  }
  return null;
}

function reviewLabel(status: ArtifactDraft["reviewStatus"]): string {
  switch (status) {
    case "approved":
      return "已通过";
    case "rejected":
      return "已驳回";
    case "modified":
      return "需修改";
    default:
      return "待审核";
  }
}

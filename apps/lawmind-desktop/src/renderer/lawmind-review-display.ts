import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";

export function reviewStatusDisplayLabel(status: ArtifactDraft["reviewStatus"] | undefined): string {
  switch (status ?? "pending") {
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

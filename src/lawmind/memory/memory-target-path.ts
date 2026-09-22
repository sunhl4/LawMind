/**
 * Resolve workspace-relative paths for MemoryAdoptionRecord targets.
 */

import type { MemoryAdoptionKind, MemoryAdoptionRecord, MemoryScope } from "./adoption-service.js";

export type MemoryTargetPathOptions = {
  /** Matter context from Inspector (when scope is matter and targetId omitted). */
  matterId?: string;
};

export function resolveMemoryTargetRelativePath(
  record: Pick<MemoryAdoptionRecord, "scope" | "kind" | "targetId">,
  opts?: MemoryTargetPathOptions,
): string | null {
  const targetId = record.targetId?.trim() || opts?.matterId?.trim();
  switch (record.scope) {
    case "lawyer":
      return "LAWYER_PROFILE.md";
    case "firm":
      return "FIRM_PROFILE.md";
    case "matter": {
      const mid = targetId;
      if (!mid) {
        return null;
      }
      // 进展类采纳落 session-summary；其它 case.* 仍写 CASE.md
      if (record.kind === "case.progress") {
        return `cases/${mid}/session-summary.md`;
      }
      return `cases/${mid}/CASE.md`;
    }
    case "assistant": {
      if (!targetId) {
        return null;
      }
      return `assistants/${targetId}/PROFILE.md`;
    }
    case "client": {
      if (!targetId) {
        return null;
      }
      return `clients/${targetId}/CLIENT_PROFILE.md`;
    }
    case "playbook":
      return resolvePlaybookPath(record.kind);
    case "opponent":
      return "playbooks/COURT_AND_OPPONENT_PROFILE.md";
    case "project":
      if (record.kind === "historical.knowledge") {
        return "memory/topics/historical-scan.md";
      }
      return null;
    default:
      return null;
  }
}

function resolvePlaybookPath(kind: MemoryAdoptionKind): string {
  if (kind === "playbook.clause_learning") {
    return "playbooks/CLAUSE_PLAYBOOK.md";
  }
  return "playbooks/CLAUSE_PLAYBOOK.md";
}

export function memoryTargetLabel(scope: MemoryScope): string {
  const labels: Record<MemoryScope, string> = {
    firm: "律所档案",
    lawyer: "律师偏好",
    client: "客户档案",
    matter: "案件 CASE",
    playbook: "条款 playbook",
    opponent: "法院/对手画像",
    project: "项目",
    assistant: "助手档案",
  };
  return labels[scope] ?? scope;
}

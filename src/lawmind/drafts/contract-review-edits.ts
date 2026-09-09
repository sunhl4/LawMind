/**
 * Structured contract-review edit proposals. Model/native callers should write
 * these instead of prose; prose parsing remains a compatibility fallback.
 */

import type { ArtifactDraft, ArtifactSection } from "../types.js";
import type { SurgicalTextEdit } from "./apply-surgical-edits.js";

export type ContractReviewEditProposal = {
  find: string;
  replace: string;
  priority?: "P0" | "P1" | "P2";
  mode?: "apply" | "opinion_only";
  reason?: string;
};

export function parseContractReviewEditProposals(value: unknown): ContractReviewEditProposal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ContractReviewEditProposal[] = [];
  for (const row of value.slice(0, 500)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const find = typeof record.find === "string" ? record.find.trim() : "";
    const replace = typeof record.replace === "string" ? record.replace.trim() : "";
    if (!find || !replace || find === replace) {
      continue;
    }
    const priority =
      record.priority === "P0" || record.priority === "P1" || record.priority === "P2"
        ? record.priority
        : undefined;
    const mode = record.mode === "opinion_only" ? "opinion_only" : "apply";
    const reason =
      typeof record.reason === "string" ? record.reason.trim().slice(0, 500) : undefined;
    out.push({
      find,
      replace,
      ...(priority ? { priority } : {}),
      mode,
      ...(reason ? { reason } : {}),
    });
  }
  return out;
}

export function proposalsToSurgicalEdits(
  proposals: ContractReviewEditProposal[],
): SurgicalTextEdit[] {
  return proposals
    .filter((proposal) => proposal.mode !== "opinion_only")
    .map((proposal) => ({
      find: proposal.find,
      replace: proposal.replace,
      note: [proposal.priority, proposal.reason].filter(Boolean).join("；") || undefined,
    }));
}

export function extractStructuredReviewEdits(draft: ArtifactDraft): SurgicalTextEdit[] {
  const raw = draft.contractReviewEdits ?? [];
  return proposalsToSurgicalEdits(parseContractReviewEditProposals(raw));
}

export function formatStructuredEditsSection(
  proposals: ContractReviewEditProposal[],
): ArtifactSection | undefined {
  if (proposals.length === 0) {
    return undefined;
  }
  return {
    heading: "结构化改稿计划",
    body: proposals
      .map(
        (proposal, index) =>
          `${index + 1}. ${proposal.priority ?? "P1"} · ${proposal.mode ?? "apply"} · find=「${proposal.find}」 · replace=「${proposal.replace}」${proposal.reason ? ` · ${proposal.reason}` : ""}`,
      )
      .join("\n"),
  };
}

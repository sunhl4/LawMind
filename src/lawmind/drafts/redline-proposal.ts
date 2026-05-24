/**
 * Redline / tracked-change proposals for review workbench (paragraph-level MVP).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ArtifactDraft, ArtifactSection } from "../types.js";
import { persistDraft, readDraft } from "./index.js";

export type RedlineHunkStatus = "pending" | "accepted" | "rejected";

export type RedlineHunk = {
  hunkId: string;
  sectionIndex: number;
  sectionHeading?: string;
  before: string;
  after: string;
  rationale?: string;
  status: RedlineHunkStatus;
};

export type RedlineProposal = {
  taskId: string;
  matterId?: string;
  baselineSections: ArtifactSection[];
  hunks: RedlineHunk[];
  updatedAt: string;
};

export function redlineProposalPath(workspaceDir: string, taskId: string): string {
  return path.join(path.resolve(workspaceDir), "drafts", `${taskId}.redline.json`);
}

export function readRedlineProposal(
  workspaceDir: string,
  taskId: string,
): RedlineProposal | undefined {
  try {
    const raw = fs.readFileSync(redlineProposalPath(workspaceDir, taskId), "utf8");
    return JSON.parse(raw) as RedlineProposal;
  } catch {
    return undefined;
  }
}

export function writeRedlineProposal(workspaceDir: string, proposal: RedlineProposal): string {
  const target = redlineProposalPath(workspaceDir, proposal.taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(proposal, null, 2));
  return target;
}

export function summarizeRedline(proposal: RedlineProposal | undefined): {
  pending: number;
  accepted: number;
  rejected: number;
} {
  if (!proposal) {
    return { pending: 0, accepted: 0, rejected: 0 };
  }
  let pending = 0;
  let accepted = 0;
  let rejected = 0;
  for (const h of proposal.hunks) {
    if (h.status === "accepted") {
      accepted++;
    } else if (h.status === "rejected") {
      rejected++;
    } else {
      pending++;
    }
  }
  return { pending, accepted, rejected };
}

function sectionsEqual(a: ArtifactSection[], b: ArtifactSection[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((s, i) => s.heading === b[i]?.heading && s.body === b[i]?.body);
}

export function generateRedlineProposal(
  workspaceDir: string,
  taskId: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }
  const existing = readRedlineProposal(workspaceDir, taskId);
  const baseline = existing?.baselineSections?.length
    ? existing.baselineSections
    : draft.sections.map((s) => ({ ...s }));
  const hunks: RedlineHunk[] = [];
  const maxLen = Math.max(baseline.length, draft.sections.length);
  for (let i = 0; i < maxLen; i++) {
    const before = baseline[i]?.body ?? "";
    const after = draft.sections[i]?.body ?? "";
    if (before === after) {
      continue;
    }
    const prior = existing?.hunks.find((h) => h.sectionIndex === i && h.status !== "pending");
    if (prior) {
      hunks.push({ ...prior, before, after });
      continue;
    }
    hunks.push({
      hunkId: randomUUID(),
      sectionIndex: i,
      sectionHeading: draft.sections[i]?.heading ?? baseline[i]?.heading,
      before,
      after,
      status: "pending",
    });
  }
  const proposal: RedlineProposal = {
    taskId,
    matterId: draft.matterId,
    baselineSections: baseline,
    hunks,
    updatedAt: new Date().toISOString(),
  };
  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal };
}

export function resolveRedlineHunk(
  workspaceDir: string,
  taskId: string,
  hunkId: string,
  decision: "accept" | "reject",
): { ok: true; proposal: RedlineProposal; draft?: ArtifactDraft } | { ok: false; error: string } {
  const proposal = readRedlineProposal(workspaceDir, taskId);
  if (!proposal) {
    return { ok: false, error: "redline_not_found" };
  }
  const hunk = proposal.hunks.find((h) => h.hunkId === hunkId);
  if (!hunk) {
    return { ok: false, error: "hunk_not_found" };
  }
  if (hunk.status !== "pending") {
    return { ok: false, error: "hunk_already_resolved" };
  }

  hunk.status = decision === "accept" ? "accepted" : "rejected";
  proposal.updatedAt = new Date().toISOString();

  let draft: ArtifactDraft | undefined;
  if (decision === "accept") {
    draft = readDraft(workspaceDir, taskId);
    if (!draft) {
      return { ok: false, error: "draft_not_found" };
    }
    const sections = [...draft.sections];
    while (sections.length <= hunk.sectionIndex) {
      sections.push({ heading: hunk.sectionHeading ?? "", body: "" });
    }
    const section = sections[hunk.sectionIndex];
    sections[hunk.sectionIndex] = {
      ...section,
      heading: hunk.sectionHeading ?? section.heading,
      body: hunk.after,
    };
    draft = { ...draft, sections };
    persistDraft(workspaceDir, draft);
    const baseline = [...proposal.baselineSections];
    while (baseline.length <= hunk.sectionIndex) {
      baseline.push({ heading: hunk.sectionHeading ?? "", body: "" });
    }
    baseline[hunk.sectionIndex] = { ...sections[hunk.sectionIndex] };
    proposal.baselineSections = baseline;
  }

  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal, draft };
}

export function resetRedlineBaselineFromDraft(
  workspaceDir: string,
  taskId: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }
  const proposal: RedlineProposal = {
    taskId,
    matterId: draft.matterId,
    baselineSections: draft.sections.map((s) => ({ ...s })),
    hunks: [],
    updatedAt: new Date().toISOString(),
  };
  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal };
}

export function redlineMatchesDraft(proposal: RedlineProposal, draft: ArtifactDraft): boolean {
  return sectionsEqual(proposal.baselineSections, draft.sections);
}
